#pragma once

#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "core/runtime/region-arena.h"

namespace mindcraft {

/**
 * Object pool of `T` slots over a {@link RegionArena}. A slot is carved from
 * the arena on first use and recycled through a free list when released; the
 * pool never returns slots to the arena. Every slot is chained, so the live
 * set is iterable via {@link forEachLive}. `alloc` hands back raw, unconstructed
 * storage that the caller initializes; on arena exhaustion it returns nullptr.
 */
template <typename T> class Pool {
public:
  /** A pool drawing slots from `arena`, which must outlive the pool. */
  explicit Pool(RegionArena& arena) : arena_(arena) {}

  /**
   * Returns a free slot - recycled if one is available, otherwise carved fresh
   * from the arena - or nullptr when the arena cannot back a new slot. The
   * storage is uninitialized.
   */
  T* alloc() {
    Slot* slot = freeList_;
    if (slot != nullptr) {
      freeList_ = slot->nextFree;
    } else {
      slot = static_cast<Slot*>(arena_.allocateBytes(sizeof(Slot), alignof(Slot)));
      if (slot == nullptr) {
        return nullptr;
      }
      slot->nextSlot = firstSlot_;
      firstSlot_ = slot;
    }
    slot->inUse = true;
    liveCount_++;
    return reinterpret_cast<T*>(&slot->payload);
  }

  /** Releases `payload` (from a prior {@link alloc}) back to the free list. */
  void free(T* payload) {
    Slot* slot = slotOf(payload);
    slot->inUse = false;
    slot->nextFree = freeList_;
    freeList_ = slot;
    liveCount_--;
  }

  /**
   * Invokes `fn(T&)` for every live slot. `fn` may release the slot it is
   * passed; releasing any other live slot during the walk is not supported.
   */
  template <typename Fn> void forEachLive(Fn&& fn) {
    for (Slot* slot = firstSlot_; slot != nullptr;) {
      Slot* next = slot->nextSlot;
      if (slot->inUse) {
        fn(*reinterpret_cast<T*>(&slot->payload));
      }
      slot = next;
    }
  }

  /** Number of slots currently allocated. */
  uint32_t liveCount() const { return liveCount_; }

private:
  struct Slot {
    Slot* nextSlot; // immutable all-slots chain, for iteration
    Slot* nextFree; // free list, valid while !inUse
    bool inUse;     // live vs. recycled
    alignas(T) unsigned char payload[sizeof(T)];
  };

  Slot* slotOf(T* payload) {
    return reinterpret_cast<Slot*>(reinterpret_cast<unsigned char*>(payload) -
                                   offsetof(Slot, payload));
  }

  RegionArena& arena_;
  Slot* firstSlot_ = nullptr;
  Slot* freeList_ = nullptr;
  uint32_t liveCount_ = 0;
};

} // namespace mindcraft
