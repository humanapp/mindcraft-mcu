#pragma once

#include <cstdint>

#include "core/platform/span.h"

namespace mindcraft {

/**
 * Stack-discipline region allocator over one shared contiguous storage span.
 * Regions are carved upward from the high-water mark of the live regions and
 * must be released in last-acquired-first-released order; releasing a region
 * rolls the high-water mark back to its base. A region held across a
 * suspension keeps its contents intact while later regions come and go above
 * it.
 */
template <typename T> class StackRegionPool {
public:
  /** A pool carving regions from `storage`, which must outlive the pool. */
  explicit StackRegionPool(Span<T> storage) : storage_(storage), top_(0) {}

  /**
   * Carve a region of `count` slots above the current high-water mark.
   * Returns the region base, or nullptr when the remaining storage is too
   * small.
   */
  T* acquire(uint32_t count) {
    if (count > storage_.size() - top_) {
      return nullptr;
    }
    T* base = storage_.data() + top_;
    top_ += count;
    return base;
  }

  /**
   * Release every region at or above `base`, rolling the high-water mark
   * back to it. Requires `base` to be a region base previously returned by
   * {@link acquire} and still live.
   */
  void releaseTo(T* base) { top_ = static_cast<uint32_t>(base - storage_.data()); }

  /** Number of slots currently carved into live regions. */
  uint32_t highWater() const { return top_; }

private:
  Span<T> storage_;
  uint32_t top_;
};

} // namespace mindcraft
