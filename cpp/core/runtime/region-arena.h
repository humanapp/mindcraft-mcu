#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "core/platform/span.h"

namespace wendoo {

/**
 * Forward-only bump allocator over one contiguous byte region. Two entry
 * points draw from the same frontier: {@link allocate} for permanent,
 * zero-filled, program-lifetime storage (the decoded program image and
 * program-sized slot tables), and {@link allocateBytes} for the raw slots
 * {@link Pool} hands out and recycles. The region owns no memory; the backing
 * storage must outlive every allocation. Exhaustion returns nullptr.
 */
class RegionArena {
public:
  /** An arena allocating from `storage`. */
  explicit RegionArena(Span<uint8_t> storage) : storage_(storage), used_(0) {}

  /**
   * Base address of the backing storage. Stable for the arena's lifetime;
   * every allocation lies at a fixed non-negative byte offset from it.
   */
  uint8_t* base() const { return storage_.data(); }

  /** Number of bytes consumed so far, including alignment padding. */
  size_t bytesUsed() const { return used_; }

  /** Number of bytes still available, before alignment padding. */
  size_t bytesRemaining() const { return storage_.size() - used_; }

  /**
   * Allocate a zero-filled array of `count` elements of T, aligned to
   * `alignof(T)`. Returns nullptr when the remaining storage cannot hold the
   * request. A `count` of 0 succeeds without consuming storage; the returned
   * pointer must not be dereferenced. For permanent, program-lifetime storage.
   */
  template <typename T> T* allocate(size_t count) {
    static_assert(std::is_trivially_copyable_v<T>, "arena elements must be trivially copyable");
    if (count > static_cast<size_t>(-1) / sizeof(T)) {
      return nullptr;
    }
    void* ptr = allocateBytes(count * sizeof(T), alignof(T));
    if (ptr != nullptr && count > 0) {
      memset(ptr, 0, count * sizeof(T));
    }
    return static_cast<T*>(ptr);
  }

  /**
   * Bump-allocate `bytes` of uninitialized storage aligned to `align` (a power
   * of two). Returns nullptr when the remaining storage cannot hold the
   * request, or a non-dereferenceable pointer when `bytes` is 0. The caller
   * initializes the storage before reading it.
   */
  void* allocateBytes(size_t bytes, size_t align) {
    const uintptr_t base = reinterpret_cast<uintptr_t>(storage_.data());
    const uintptr_t unaligned = base + used_;
    const uintptr_t aligned = (unaligned + align - 1) & ~(uintptr_t(align) - 1);
    const size_t padded = used_ + static_cast<size_t>(aligned - unaligned);
    if (padded > storage_.size() || bytes > storage_.size() - padded) {
      return nullptr;
    }
    used_ = padded + bytes;
    return storage_.data() + padded;
  }

private:
  Span<uint8_t> storage_;
  size_t used_;
};

} // namespace wendoo
