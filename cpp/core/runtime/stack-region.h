#pragma once

#include <cstddef>
#include <cstdint>

#include "core/runtime/managed-heap.h"
#include "core/runtime/region-arena.h"

namespace mindcraft {

/**
 * Grow-on-demand backing for a fiber's execution regions (operand stack,
 * locals, frame stack, try-handler stack). Each region is a contiguous,
 * slab-backed block addressed by `base + depth`; it starts small and grows
 * geometrically toward its cap by reallocation, reusing the list-backing
 * pattern the managed heap uses for container backings (allocate a bigger
 * block, copy the live elements, recycle the old block to its size class).
 *
 * A dedicated {@link SlabAllocator} over the shared region backs the blocks; no
 * managed heap is required. A grow never collects: it draws from the slab and
 * fails - the caller faults `StackOverflow` - only when the arena is exhausted.
 * Blocks are recycled across fibers through the slab's free lists at reclaim.
 */
class StackRegionAllocator {
public:
  /** An allocator drawing region blocks from `arena`, which must outlive it. */
  explicit StackRegionAllocator(RegionArena& arena) : slabs_(arena) {}

  /**
   * Reserves an initial block of `slots` elements of `T`, or null when the
   * arena cannot back it. The block is uninitialized; the caller seeds the
   * live prefix.
   */
  template <typename T> T* reserve(uint32_t slots) {
    return static_cast<T*>(slabs_.allocate(static_cast<size_t>(slots) * sizeof(T)));
  }

  /**
   * Grows the region at `base` (capacity `*capacity`, holding `live` live
   * elements) to hold at least `needed` elements, capped at `cap`. On success
   * updates `*base` and `*capacity` to the larger block (live elements copied,
   * old block recycled) and returns true. Returns false leaving the region
   * untouched when the arena cannot back the larger block; a no-op success when
   * `needed` already fits. `needed` must not exceed `cap` (the caller checks the
   * cap guard first).
   */
  template <typename T>
  bool grow(T** base, uint32_t* capacity, uint32_t live, uint32_t needed, uint32_t cap) {
    if (needed <= *capacity) {
      return true;
    }
    uint32_t newCap = *capacity < 2 ? 2 : *capacity;
    while (newCap < needed) {
      newCap *= 2;
    }
    if (newCap > cap) {
      newCap = cap;
    }
    void* block = slabs_.allocate(static_cast<size_t>(newCap) * sizeof(T));
    if (block == nullptr) {
      return false;
    }
    T* grown = static_cast<T*>(block);
    for (uint32_t i = 0; i < live; i++) {
      grown[i] = (*base)[i];
    }
    if (*base != nullptr) {
      slabs_.release(*base, static_cast<size_t>(*capacity) * sizeof(T));
    }
    *base = grown;
    *capacity = newCap;
    return true;
  }

  /** Recycles a region block of `capacity` elements of `T` back to its slab class. */
  template <typename T> void release(T* base, uint32_t capacity) {
    if (base != nullptr) {
      slabs_.release(base, static_cast<size_t>(capacity) * sizeof(T));
    }
  }

private:
  SlabAllocator slabs_;
};

} // namespace mindcraft
