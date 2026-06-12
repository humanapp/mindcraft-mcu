#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "core/platform/span.h"

namespace mindcraft {

/**
 * Bump allocator for building a {@link ProgramImage} inside one contiguous
 * caller-provided buffer. Allocations are naturally aligned, zero-filled,
 * and never freed individually; the arena owns no memory and the backing
 * storage must outlive every allocation. Construct, allocate the image's
 * pools, then treat the buffer as read-only.
 */
class ProgramArena {
public:
  /** An arena allocating from `storage`. */
  explicit ProgramArena(Span<uint8_t> storage) : storage_(storage), used_(0) {}

  /** Number of bytes consumed so far, including alignment padding. */
  size_t bytesUsed() const { return used_; }

  /** Number of bytes still available, before alignment padding. */
  size_t bytesRemaining() const { return storage_.size() - used_; }

  /**
   * Allocate a zero-filled array of `count` elements of T, aligned to
   * `alignof(T)`. Returns nullptr when the remaining storage cannot hold the
   * request. A `count` of 0 succeeds without consuming storage; the returned
   * pointer must not be dereferenced.
   */
  template <typename T> T* allocate(size_t count) {
    static_assert(std::is_trivially_copyable_v<T>, "arena elements must be trivially copyable");
    static_assert(std::is_trivially_default_constructible_v<T>,
                  "arena elements must be trivially default constructible");
    const uintptr_t base = reinterpret_cast<uintptr_t>(storage_.data());
    const uintptr_t unaligned = base + used_;
    const uintptr_t aligned = (unaligned + alignof(T) - 1) & ~(uintptr_t(alignof(T)) - 1);
    const size_t padded = used_ + static_cast<size_t>(aligned - unaligned);
    if (padded > storage_.size() || count > (storage_.size() - padded) / sizeof(T)) {
      return nullptr;
    }
    const size_t bytes = count * sizeof(T);
    used_ = padded + bytes;
    uint8_t* ptr = storage_.data() + padded;
    if (bytes > 0) {
      memset(ptr, 0, bytes);
    }
    return reinterpret_cast<T*>(ptr);
  }

private:
  Span<uint8_t> storage_;
  size_t used_;
};

} // namespace mindcraft
