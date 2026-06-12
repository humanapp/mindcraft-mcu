#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "core/platform/span.h"
#include "core/runtime/load-error.h"
#include "core/runtime/result.h"

namespace mindcraft {

/**
 * Bounds-checked forward read cursor over a read-only byte buffer. Every read
 * returns a {@link Result} carrying the decoded value or a {@link LoadError};
 * a failed read leaves the cursor mid-stream, so callers must stop reading
 * after the first failure. The viewed buffer must outlive the cursor.
 *
 * Wire encodings match the TS `MemoryStream` in
 * external/mindcraft-lang/packages/core/src/platform/stream.node.ts:
 * var-uints are ULEB128 limited to 32 bits (at most 5 bytes; the 5th byte
 * carries at most 4 payload bits and no continuation flag), var-ints are
 * zigzag-mapped var-uints, and f32 payloads are 4 little-endian bytes of the
 * IEEE 754 bit pattern.
 */
class ByteCursor {
public:
  /** A cursor positioned at the start of `bytes`. */
  explicit constexpr ByteCursor(ByteSpan bytes) : bytes_(bytes), offset_(0) {}

  /** Byte offset of the next read, from the start of the buffer. */
  constexpr size_t offset() const { return offset_; }

  /** Number of unread bytes. */
  constexpr size_t remaining() const { return bytes_.size() - offset_; }

  /** True when every byte has been consumed. */
  constexpr bool atEnd() const { return offset_ == bytes_.size(); }

  /** Read one raw byte. Fails with `Truncated` at the end of the buffer. */
  Result<uint8_t, LoadError> readU8() {
    if (offset_ >= bytes_.size()) {
      return Result<uint8_t, LoadError>::fail(LoadError::Truncated);
    }
    return Result<uint8_t, LoadError>::ok(bytes_[offset_++]);
  }

  /**
   * Read a ULEB128 var-uint into 32 bits. Fails with `Truncated` when the
   * buffer ends mid-encoding and `VarIntOverflow` when the encoding needs a
   * 6th byte or carries payload bits above bit 31.
   */
  Result<uint32_t, LoadError> readVarUint() {
    uint32_t value = 0;
    for (uint32_t i = 0; i < 5; i++) {
      if (offset_ >= bytes_.size()) {
        return Result<uint32_t, LoadError>::fail(LoadError::Truncated);
      }
      const uint8_t byte = bytes_[offset_++];
      const uint32_t payload = byte & 0x7f;
      // The 5th byte carries bits 28..34; only bits 28..31 fit a u32.
      if (i == 4 && payload > 0x0f) {
        return Result<uint32_t, LoadError>::fail(LoadError::VarIntOverflow);
      }
      value |= payload << (7 * i);
      if ((byte & 0x80) == 0) {
        return Result<uint32_t, LoadError>::ok(value);
      }
    }
    // Five continuation-flagged bytes would require a 6th byte.
    return Result<uint32_t, LoadError>::fail(LoadError::VarIntOverflow);
  }

  /** Read a zigzag-mapped var-uint as a signed 32-bit value. */
  Result<int32_t, LoadError> readVarInt() {
    const Result<uint32_t, LoadError> raw = readVarUint();
    if (!raw.isOk()) {
      return Result<int32_t, LoadError>::fail(raw.error());
    }
    const uint32_t u = raw.value();
    const uint32_t magnitude = u >> 1;
    const int32_t value =
        (u & 1) != 0 ? -static_cast<int32_t>(magnitude) - 1 : static_cast<int32_t>(magnitude);
    return Result<int32_t, LoadError>::ok(value);
  }

  /**
   * Read an f32 from 4 little-endian payload bytes. The bit pattern is
   * assembled into a u32 and copied into the float, never loaded through a
   * pointer into the buffer.
   */
  Result<float, LoadError> readF32() {
    if (remaining() < 4) {
      return Result<float, LoadError>::fail(LoadError::Truncated);
    }
    const uint32_t bits = static_cast<uint32_t>(bytes_[offset_]) |
                          (static_cast<uint32_t>(bytes_[offset_ + 1]) << 8) |
                          (static_cast<uint32_t>(bytes_[offset_ + 2]) << 16) |
                          (static_cast<uint32_t>(bytes_[offset_ + 3]) << 24);
    offset_ += 4;
    float value;
    static_assert(sizeof(value) == sizeof(bits), "f32 payloads are 4 bytes");
    memcpy(&value, &bits, sizeof(value));
    return Result<float, LoadError>::ok(value);
  }

  /**
   * Read `length` raw bytes as a borrowed view into the underlying buffer.
   * Fails with `Truncated` when fewer than `length` bytes remain.
   */
  Result<ByteSpan, LoadError> readBytes(size_t length) {
    if (remaining() < length) {
      return Result<ByteSpan, LoadError>::fail(LoadError::Truncated);
    }
    const ByteSpan view(bytes_.data() + offset_, length);
    offset_ += length;
    return Result<ByteSpan, LoadError>::ok(view);
  }

private:
  ByteSpan bytes_;
  size_t offset_;
};

} // namespace mindcraft
