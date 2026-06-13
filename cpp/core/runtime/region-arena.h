#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "core/platform/span.h"

namespace mindcraft {

/**
 * One contiguous carve-on-demand arena over a caller-provided byte buffer -
 * the single block of VM working memory a device hands the runtime. It serves
 * two roles from the same storage:
 *
 * - {@link allocate} bump-allocates the permanent program image (functions,
 *   pools, type table, strings), zero-filled and never released; and
 * - {@link carve} / {@link mark} / {@link releaseTo} provide a LIFO region
 *   discipline for transient fiber stack/locals/frame segments, acquired at
 *   spawn above the image's high-water and released at reclaim.
 *
 * Nothing is pre-partitioned or pre-committed: a dormant fiber slot costs no
 * arena bytes, and a frame-heavy fiber and a stack-heavy fiber draw from the
 * same free space. The arena owns no memory; the backing storage must outlive
 * every allocation. Exhaustion is reported as a nullptr return (a deterministic
 * fault at the call site), never an overrun.
 */
class RegionArena {
public:
  /** Opaque high-water position for {@link releaseTo}. */
  using Mark = size_t;

  /** An arena allocating from `storage`. */
  explicit RegionArena(Span<uint8_t> storage) : storage_(storage), used_(0) {}

  /** Number of bytes consumed so far, including alignment padding. */
  size_t bytesUsed() const { return used_; }

  /** Number of bytes still available, before alignment padding. */
  size_t bytesRemaining() const { return storage_.size() - used_; }

  /**
   * Allocate a zero-filled array of `count` elements of T, aligned to
   * `alignof(T)`. Returns nullptr when the remaining storage cannot hold the
   * request. A `count` of 0 succeeds without consuming storage; the returned
   * pointer must not be dereferenced. For permanent allocations (the program
   * image); not released by {@link releaseTo} in normal use.
   */
  template <typename T> T* allocate(size_t count) {
    T* ptr = bump<T>(count);
    if (ptr != nullptr && count > 0) {
      memset(ptr, 0, count * sizeof(T));
    }
    return ptr;
  }

  /**
   * Carve an uninitialized array of `count` elements of T, aligned to
   * `alignof(T)`, above the current high-water. Returns nullptr when the
   * remaining storage cannot hold the request. For transient fiber segments,
   * which the execution state initializes as it runs; released in LIFO order
   * via {@link releaseTo}.
   */
  template <typename T> T* carve(size_t count) { return bump<T>(count); }

  /** The current high-water, a rollback point for {@link releaseTo}. */
  Mark mark() const { return used_; }

  /**
   * Roll the high-water back to `mark`, freeing every region carved since it
   * was taken. Requires `mark` to be a position previously returned by
   * {@link mark} with no still-live region carved above it (LIFO discipline).
   */
  void releaseTo(Mark mark) { used_ = mark; }

private:
  template <typename T> T* bump(size_t count) {
    static_assert(std::is_trivially_copyable_v<T>, "arena elements must be trivially copyable");
    const uintptr_t base = reinterpret_cast<uintptr_t>(storage_.data());
    const uintptr_t unaligned = base + used_;
    const uintptr_t aligned = (unaligned + alignof(T) - 1) & ~(uintptr_t(alignof(T)) - 1);
    const size_t padded = used_ + static_cast<size_t>(aligned - unaligned);
    if (padded > storage_.size() || count > (storage_.size() - padded) / sizeof(T)) {
      return nullptr;
    }
    used_ = padded + count * sizeof(T);
    return reinterpret_cast<T*>(storage_.data() + padded);
  }

  Span<uint8_t> storage_;
  size_t used_;
};

} // namespace mindcraft
