#pragma once

#include <cstddef>
#include <cstdint>

namespace mindcraft {

/**
 * Non-owning view over a contiguous run of `size` elements starting at
 * `data`. The viewed storage must outlive the span. Indexing past
 * `size() - 1` is undefined.
 */
template <typename T> class Span {
public:
  /** An empty view. */
  constexpr Span() : data_(nullptr), size_(0) {}

  /** A view over `size` elements starting at `data`. */
  constexpr Span(T* data, size_t size) : data_(data), size_(size) {}

  /** Pointer to the first element, or nullptr for an empty view. */
  constexpr T* data() const { return data_; }

  /** Number of elements in the view. */
  constexpr size_t size() const { return size_; }

  /** True when the view contains no elements. */
  constexpr bool empty() const { return size_ == 0; }

  /** The element at `index`. Requires `index < size()`. */
  constexpr T& operator[](size_t index) const { return data_[index]; }

  constexpr T* begin() const { return data_; }
  constexpr T* end() const { return data_ + size_; }

private:
  T* data_;
  size_t size_;
};

/** Read-only view over raw bytes. */
using ByteSpan = Span<const uint8_t>;

} // namespace mindcraft
