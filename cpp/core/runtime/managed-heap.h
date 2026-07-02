#pragma once

#include <cstddef>
#include <cstdint>

#include "core/runtime/mc-number.h"
#include "core/runtime/pool.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"

namespace mindcraft {

class TypeRegistry;

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

/**
 * A managed string: a contiguous UTF-8 byte backing drawn from a size-classed
 * slab, plus its byte length. The backing is fixed at allocation and never
 * grows. The collector frees the byte backing when the object is collected. A
 * zero-length string has a null `bytes`. `mark` is the collector's reachability
 * bit, clear between collections.
 */
struct StringObject {
  char* bytes;
  uint32_t length;
  bool mark;
};

/**
 * A managed buffer: a contiguous raw-byte backing (each byte 0-255) drawn from
 * a size-classed slab, plus its byte length. The backing is fixed at allocation
 * and never grows; the bytes are immutable after construction. The collector
 * frees the byte backing when the object is collected. A zero-length buffer has
 * a null `bytes`. `mark` is the collector's reachability bit, clear between
 * collections.
 */
struct BufferObject {
  uint8_t* bytes;
  uint32_t length;
  bool mark;
};

/**
 * One ordered-map key: a number, a borrowed constant-pool string, or a managed
 * (heap) string. String keys compare by byte content across both
 * representations; a borrowed and a managed key with equal content are one key.
 */
struct MapKey {
  /** True when the key is a number; false when it is a string. */
  bool isNumber;
  /**
   * For a string key: true when {@link stringRef} is a managed-heap handle,
   * false when it is a borrowed constant-pool string-table index.
   */
  bool isManagedString;
  /** Number key payload (meaningful when {@link isNumber}). */
  mc_number_t number;
  /**
   * String key reference (meaningful when not {@link isNumber}): a borrowed
   * string-table index or a managed-heap string handle, per
   * {@link isManagedString}.
   */
  uint32_t stringRef;
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
  /**
   * A heap drawing its pools and slabs from `arena`, which must outlive it.
   * `program`, when non-null, resolves borrowed (constant-pool) string content
   * for content-equality of string map keys; it must outlive the heap. With a
   * null program, only number keys and managed-string keys compare by content
   * and borrowed-string keys fall back to index identity (the linker's
   * content-dedup guarantee).
   */
  explicit ManagedHeap(RegionArena& arena, const ProgramImage* program = nullptr);

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

  /**
   * Allocates an immutable managed string of `length` bytes, returning a
   * `String` value (managed reference) in `out` and a writable pointer to the
   * uninitialized backing in `bytesOut` (null when `length` is 0). The caller
   * fills the backing directly; the result must be fully written before the
   * next allocation that could collect. See {@link newStruct} for the
   * exhaustion contract.
   */
  bool allocString(uint32_t length, GcRoots* roots, Value& out, char*& bytesOut);

  /** Allocates a managed string copied from `data[0, length)`. See {@link allocString}. */
  bool newString(const char* data, uint32_t length, GcRoots* roots, Value& out);

  /** Resolves a managed `String` value to its object. Requires a live managed handle. */
  StringObject* stringObject(const Value& value) const;

  /**
   * Allocates an immutable managed buffer of `length` bytes, returning a managed
   * `Buffer` value in `out` and a writable pointer to the uninitialized backing
   * in `bytesOut` (null when `length` is 0). The caller fills the backing
   * directly; the result must be fully written before the next allocation that
   * could collect. See {@link newStruct} for the exhaustion contract.
   */
  bool allocBuffer(uint32_t length, GcRoots* roots, Value& out, uint8_t*& bytesOut);

  /** Allocates a managed buffer copied from `data[0, length)`. See {@link allocBuffer}. */
  bool newBuffer(const uint8_t* data, uint32_t length, GcRoots* roots, Value& out);

  /** Resolves a managed `Buffer` value to its object. Requires a live managed handle. */
  BufferObject* bufferObject(const Value& value) const;

  /**
   * Yields the raw bytes of any `Buffer` value into `bytes`/`length`: managed
   * buffers resolve through the heap, borrowed buffers through the configured
   * program's borrowed bytes. Returns false for a non-buffer value or a borrowed
   * buffer with no program configured or an out-of-range run.
   */
  bool bufferContent(const Value& value, const uint8_t*& bytes, uint32_t& length) const;

  /** Whether two `Buffer` values hold byte-for-byte identical content, across borrowed and managed.
   */
  bool buffersEqual(const Value& a, const Value& b) const;

  /**
   * Yields the UTF-8 content of any `String` value into `bytes`/`length`:
   * managed strings resolve through the heap, borrowed strings through the
   * configured program string table. Returns false for a non-string value or a
   * borrowed string with no program configured.
   */
  bool stringContent(const Value& value, const char*& bytes, uint32_t& length) const;

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

  /**
   * Registers the type registry that recognizes managed struct types during
   * tracing. A struct value whose type is not a managed struct type (an
   * injected execution context, a device receiver) is not heap-backed and
   * `mark` skips it. Must be set before the first collection that can
   * enumerate a fiber holding such a value.
   */
  void setTypes(const TypeRegistry* types) { types_ = types; }

  /** Number of live list objects (for tests and stats). */
  uint32_t liveListCount() const { return lists_.liveCount(); }

  /** Number of live map objects (for tests and stats). */
  uint32_t liveMapCount() const { return maps_.liveCount(); }

  /** Number of live struct objects (for tests and stats). */
  uint32_t liveStructCount() const { return structs_.liveCount(); }

  /** Number of live captures objects (for tests and stats). */
  uint32_t liveCaptureCount() const { return captures_.liveCount(); }

  /** Number of live managed-string objects (for tests and stats). */
  uint32_t liveStringCount() const { return strings_.liveCount(); }

  /** Number of live managed-buffer objects (for tests and stats). */
  uint32_t liveBufferCount() const { return buffers_.liveCount(); }

  /**
   * Grows a list's backing to at least `capacity` slots without changing its
   * size, collecting over `roots` and retrying once on slab exhaustion. With a
   * reserved backing, an append up to `capacity` neither allocates nor
   * collects. Returns false only when the backing cannot grow.
   */
  bool listReserve(ListObject* obj, uint32_t capacity, GcRoots* roots);

  // One pinned value on an intrusive chain the collector marks as an extra root.
  struct PinNode {
    Value value;
    PinNode* next;
  };

  /**
   * RAII root pin: keeps `value` reachable across every collection that runs
   * for the guard's lifetime.
   */
  class Pin {
  public:
    Pin(ManagedHeap& heap, const Value& value) : heap_(heap), node_{value, heap.pinHead_} {
      heap.pinHead_ = &node_;
    }
    ~Pin() { heap_.pinHead_ = node_.next; }
    Pin(const Pin&) = delete;
    Pin& operator=(const Pin&) = delete;

  private:
    ManagedHeap& heap_;
    PinNode node_;
  };

private:
  // A non-null roots wrapper for the allocations inside a deep copy, so each
  // collects over the caller's roots on failure. The in-flight copies are kept
  // reachable by {@link collect} marking the pin chain.
  class DeepCopyRoots : public GcRoots {
  public:
    explicit DeepCopyRoots(GcRoots* external) : external_(external) {}
    void enumerateRoots(GcMarker& marker) override {
      if (external_ != nullptr) {
        external_->enumerateRoots(marker);
      }
    }

  private:
    GcRoots* external_;
  };

  ListObject* allocListObject(GcRoots* roots);
  MapObject* allocMapObject(GcRoots* roots);
  bool listEnsureCapacity(ListObject* obj, uint32_t needed, GcRoots* roots);
  bool mapEnsureCapacity(MapObject* obj, uint32_t needed, GcRoots* roots);
  uint32_t mapFind(const MapObject* obj, const MapKey& key) const;
  bool deepCopyInto(const Value& value, DeepCopyRoots& roots, Value& out);
  // Resolves a map key's string content for content comparison. Returns false
  // for a borrowed key with no program configured.
  bool keyStringContent(const MapKey& key, const char*& bytes, uint32_t& length) const;
  bool keyEqual(const MapKey& a, const MapKey& b) const;

  uint32_t handleOf(const void* object) const {
    return static_cast<uint32_t>(static_cast<const uint8_t*>(object) - base_);
  }
  void* fromHandle(uint32_t handle) const { return base_ + handle; }

  uint8_t* base_;
  const ProgramImage* program_;
  SlabAllocator slabs_;
  Pool<ListObject> lists_;
  Pool<MapObject> maps_;
  Pool<StructObject> structs_;
  Pool<CapturesObject> captures_;
  Pool<StringObject> strings_;
  Pool<BufferObject> buffers_;
  PinNode* pinHead_ = nullptr;
  const TypeRegistry* types_ = nullptr;
};

} // namespace mindcraft
