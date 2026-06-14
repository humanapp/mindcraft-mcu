#pragma once

#include <cstddef>
#include <cstdint>

#include "core/runtime/mc-number.h"
#include "core/runtime/pool.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Sink the root sources mark into during a collection. The collector traces
 * each marked container value, so a root source need only mark the values it
 * holds directly.
 */
class GcMarker {
public:
  /** Marks `value` and, when it is a container, everything reachable from it. */
  virtual void mark(const Value& value) = 0;

protected:
  ~GcMarker() = default;
};

/**
 * Source of live garbage-collection roots. A collection enumerates every root
 * value into the marker: operand stacks, frame locals, brain variable slots,
 * and per-callsite host state across all live fibers. Implemented by the fiber
 * scheduler, which holds every live execution.
 */
class GcRoots {
public:
  /** Marks every live root value into `marker`. */
  virtual void enumerateRoots(GcMarker& marker) = 0;

protected:
  ~GcRoots() = default;
};

/**
 * A managed list: a contiguous {@link Value} backing drawn from a size-classed
 * slab, plus its live length and capacity. The backing grows geometrically and
 * is recycled to the slab allocator when the object is collected. `mark` is the
 * collector's reachability bit, clear between collections.
 */
struct ListObject {
  Value* items;
  uint32_t size;
  uint32_t capacity;
  bool mark;
};

/** One ordered-map key: a number or a borrowed constant-pool string. */
struct MapKey {
  /** True when the key is a number; false when it is a borrowed string. */
  bool isNumber;
  /** Number key payload (meaningful when {@link isNumber}). */
  mc_number_t number;
  /** Borrowed string-table index (meaningful when not {@link isNumber}). */
  uint32_t stringIndex;
};

/** One ordered-map entry: a key and its value, in insertion order. */
struct MapEntry {
  MapKey key;
  Value value;
};

/**
 * A managed map: an insertion-ordered {@link MapEntry} backing drawn from a
 * size-classed slab, plus its live entry count and capacity. Updating an
 * existing key keeps its position; deleting removes it; re-inserting a deleted
 * key appends. The backing grows geometrically and is recycled when collected.
 */
struct MapObject {
  MapEntry* entries;
  uint32_t size;
  uint32_t capacity;
  bool mark;
};

/**
 * A managed closed struct: a fixed `slotCount`-sized {@link Value} slot array
 * drawn from a size-classed slab and indexed directly by numeric field id
 * (`maxFieldId + 1` slots; retired ids leave reserved nil holes). The backing
 * is fixed at allocation and never grows. `mark` is the collector's
 * reachability bit; `copying` guards the recursive deep copy against
 * self-referential cycles. A fieldless struct has `slotCount == 0` and a null
 * `slots`.
 */
struct StructObject {
  Value* slots;
  uint32_t slotCount;
  bool mark;
  bool copying;
};

/**
 * A managed closure capture environment: a fixed `count`-sized {@link Value}
 * array drawn from a size-classed slab, referenced by a `Function` value's
 * captures handle. The collector traces its values; the backing never grows.
 */
struct CapturesObject {
  Value* slots;
  uint32_t count;
  bool mark;
};

/**
 * Segregated free-list allocator for the variable-length container backings
 * over a {@link RegionArena}. Requests round up to a power-of-two size class;
 * each class keeps a free list of recycled blocks, and a fresh block is carved
 * from the arena only when its class is empty. Blocks are never returned to the
 * arena, only to their class.
 */
class SlabAllocator {
public:
  /** Smallest block order: 2^5 = 32 bytes, holding two `Value`s. */
  static constexpr uint32_t kMinOrder = 5;
  /**
   * Largest block order: 2^16 = 64 KiB. A backing cannot exceed it; a larger
   * request fails.
   */
  static constexpr uint32_t kMaxOrder = 16;

  /** An allocator drawing blocks from `arena`, which must outlive it. */
  explicit SlabAllocator(RegionArena& arena) : arena_(arena) {}

  /**
   * Returns a block of at least `bytes`, recycled from its size class or carved
   * fresh, or nullptr when `bytes` exceeds {@link kMaxOrder} or the arena
   * cannot back a new block of the class.
   */
  void* allocate(size_t bytes);

  /**
   * Returns the block at `block` (from a prior {@link allocate} of the same
   * `bytes`) to its size class for reuse. `bytes` must match the originating
   * request so the block lands in the class it was drawn from.
   */
  void release(void* block, size_t bytes);

private:
  static uint32_t orderForBytes(size_t bytes);

  RegionArena& arena_;
  // Free-list head per power-of-two order; a free block's first word holds the
  // next pointer. Indices below kMinOrder are unused.
  void* bins_[kMaxOrder + 1] = {};
};

/**
 * The managed heap: the mark-sweep collector and the pools backing the list and
 * map value types. List and map objects are drawn from {@link Pool} instances
 * over the shared region and their variable-length backings from a
 * {@link SlabAllocator} over the same region. A container value's handle is the
 * byte offset of its object within the region; resolving it is a
 * base-plus-offset.
 *
 * Allocation is collect-on-fail: an exhausted pool or slab triggers a precise
 * mark-sweep over the supplied roots and a single retry; a still-failing
 * request returns failure for the caller to fault deterministically. Collection
 * runs only when an allocation asks for it, at the between-instruction
 * boundaries the dispatch loop keeps quiescent under single-entry.
 */
class ManagedHeap : public GcMarker {
public:
  /** A heap drawing its pools and slabs from `arena`, which must outlive it. */
  explicit ManagedHeap(RegionArena& arena);

  /**
   * Allocates an empty list typed `typeId`, collecting over `roots` and
   * retrying once on exhaustion. Returns false (leaving `out` untouched) when
   * the heap cannot back the object. `roots` may be null only when the caller
   * guarantees no collection is needed.
   */
  bool newList(uint32_t typeId, GcRoots* roots, Value& out);

  /** Allocates an empty map typed `typeId`. See {@link newList}. */
  bool newMap(uint32_t typeId, GcRoots* roots, Value& out);

  /**
   * Allocates a closed struct typed `typeId` with `slotCount` nil field slots,
   * collecting over `roots` and retrying once on exhaustion. Returns false
   * (leaving `out` untouched) when the heap cannot back the object.
   */
  bool newStruct(uint32_t typeId, uint32_t slotCount, GcRoots* roots, Value& out);

  /**
   * Allocates a captures environment of `count` nil slots, returning its handle
   * in `out`. See {@link newStruct} for the exhaustion contract.
   */
  bool newCaptures(uint32_t count, GcRoots* roots, uint32_t& out);

  /** Resolves a `List` value to its object. Requires a live list handle. */
  ListObject* list(const Value& value) const;

  /** Resolves a `Map` value to its object. Requires a live map handle. */
  MapObject* map(const Value& value) const;

  /** Resolves a `Struct` value to its object. Requires a live struct handle. */
  StructObject* structOf(const Value& value) const;

  /** Resolves a captures handle to its object. Requires a live handle. */
  CapturesObject* captures(uint32_t handle) const;

  // Closed-struct field access by numeric field id (the storage slot). A read
  // or write outside `[0, slotCount)` yields nil / is dropped.

  Value structGet(const StructObject* obj, uint32_t fieldId) const;
  void structSet(StructObject* obj, uint32_t fieldId, const Value& value);

  /**
   * Deep-copies a struct value (recursively, struct slots only) into `out`;
   * lists, maps, and primitives pass through by reference. Self-referential
   * structs terminate: a node already being copied yields the original.
   * Allocates new structs, keeping the in-flight copies rooted across a
   * collection; returns false on heap exhaustion.
   */
  bool deepCopy(const Value& value, GcRoots* roots, Value& out);

  // List operations. Indices are pre-floored integers; reads and removes past
  // the ends yield nil and empty pop/shift yield nil. The appending mutations
  // (push, insert) grow the backing on demand, collecting over `roots` on slab
  // exhaustion and returning false only when it cannot grow; in-place set/swap
  // never allocate.

  bool listPush(ListObject* obj, const Value& item, GcRoots* roots);
  Value listGet(const ListObject* obj, int32_t index) const;
  void listSet(ListObject* obj, int32_t index, const Value& value);
  Value listPop(ListObject* obj);
  Value listShift(ListObject* obj);
  Value listRemove(ListObject* obj, int32_t index);
  bool listInsert(ListObject* obj, int32_t index, const Value& value, GcRoots* roots);
  void listSwap(ListObject* obj, int32_t i, int32_t j);

  // Map operations. Number keys compare by SameValueZero (NaN is a usable key;
  // +0 and -0 are one key); borrowed string keys compare by constant-pool index
  // (equal content shares one deduplicated index). Insertion order is preserved
  // across updates and deletes.

  bool mapSet(MapObject* obj, const MapKey& key, const Value& value, GcRoots* roots);
  Value mapGet(const MapObject* obj, const MapKey& key) const;
  bool mapHas(const MapObject* obj, const MapKey& key) const;
  void mapDelete(MapObject* obj, const MapKey& key);

  /** Runs one precise mark-sweep collection over `roots`. */
  void collect(GcRoots& roots);

  /** Marks `value` and traces it when it is a container (the {@link GcMarker}). */
  void mark(const Value& value) override;

  /** Number of live list objects (for tests and stats). */
  uint32_t liveListCount() const { return lists_.liveCount(); }

  /** Number of live map objects (for tests and stats). */
  uint32_t liveMapCount() const { return maps_.liveCount(); }

  /** Number of live struct objects (for tests and stats). */
  uint32_t liveStructCount() const { return structs_.liveCount(); }

  /** Number of live captures objects (for tests and stats). */
  uint32_t liveCaptureCount() const { return captures_.liveCount(); }

private:
  // One in-flight deep-copy result on an intrusive chain the collector marks as
  // a root, keeping parent copies reachable while their children allocate.
  struct PinNode {
    Value value;
    PinNode* next;
  };

  // Augments the caller's roots with the pinned in-flight deep-copy results for
  // the duration of a deep copy.
  class DeepCopyRoots : public GcRoots {
  public:
    DeepCopyRoots(ManagedHeap& heap, GcRoots* external) : heap_(heap), external_(external) {}
    void enumerateRoots(GcMarker& marker) override {
      if (external_ != nullptr) {
        external_->enumerateRoots(marker);
      }
      for (PinNode* node = heap_.pinHead_; node != nullptr; node = node->next) {
        marker.mark(node->value);
      }
    }

  private:
    ManagedHeap& heap_;
    GcRoots* external_;
  };

  ListObject* allocListObject(GcRoots* roots);
  MapObject* allocMapObject(GcRoots* roots);
  bool listEnsureCapacity(ListObject* obj, uint32_t needed, GcRoots* roots);
  bool mapEnsureCapacity(MapObject* obj, uint32_t needed, GcRoots* roots);
  uint32_t mapFind(const MapObject* obj, const MapKey& key) const;
  bool deepCopyInto(const Value& value, DeepCopyRoots& roots, Value& out);

  uint32_t handleOf(const void* object) const {
    return static_cast<uint32_t>(static_cast<const uint8_t*>(object) - base_);
  }
  void* fromHandle(uint32_t handle) const { return base_ + handle; }

  uint8_t* base_;
  SlabAllocator slabs_;
  Pool<ListObject> lists_;
  Pool<MapObject> maps_;
  Pool<StructObject> structs_;
  Pool<CapturesObject> captures_;
  PinNode* pinHead_ = nullptr;
};

} // namespace mindcraft
