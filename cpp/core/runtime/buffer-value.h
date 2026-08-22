#pragma once

#include <cstdint>
#include <cstring>

#include "core/platform/span.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace wendoo {

/**
 * Resolve a borrowed buffer value to its bytes inside `image`. Returns the
 * borrowed run as a {@link ByteSpan}, or an empty span when `value` is not a
 * borrowed buffer (a managed buffer resolves through {@link
 * ManagedHeap::bufferContent}) or its range falls outside the image's borrowed
 * bytes.
 */
inline ByteSpan bufferBytes(const ProgramImage& image, const Value& value) {
  if (!value.isBuffer() || value.isManagedBuffer()) {
    return ByteSpan(nullptr, 0);
  }
  const uint32_t offset = value.bufferOffset();
  const uint32_t count = value.bufferLength();
  if (offset > image.stringData.size() || count > image.stringData.size() - offset) {
    return ByteSpan(nullptr, 0);
  }
  return ByteSpan(image.stringData.data() + offset, count);
}

/** Whether two borrowed buffer values from `image` hold byte-for-byte identical content. */
inline bool buffersEqual(const ProgramImage& image, const Value& a, const Value& b) {
  if (!a.isBuffer() || !b.isBuffer()) {
    return false;
  }
  const ByteSpan aBytes = bufferBytes(image, a);
  const ByteSpan bBytes = bufferBytes(image, b);
  if (aBytes.size() != bBytes.size()) {
    return false;
  }
  return aBytes.size() == 0 || memcmp(aBytes.data(), bBytes.data(), aBytes.size()) == 0;
}

} // namespace wendoo
