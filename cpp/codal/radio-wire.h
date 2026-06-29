#pragma once

#include <cstdint>
#include <cstring>

#include "core/runtime/mc-number.h"

namespace mindcraft {

/**
 * MakeCode radio packet types, mirrored byte-for-byte from `pxt-common-packages`
 * `libs/radio` and from `packages/wodal/src/core/radio.ts`. The numeric value is
 * the packet's first on-air byte.
 */
enum class RadioPacketType : int {
  Number = 0,
  Value = 1,
  String = 2,
  Buffer = 3,
  Double = 4,
  DoubleValue = 5,
};

/** Type tag for a raw datagram (arbitrary bytes, no MakeCode prefix). */
inline constexpr int kRadioRawPacketType = -1;

/** On-air datagram frame size in bytes, CODAL `RADIO_MAX_PACKET_SIZE`. */
inline constexpr uint32_t kRadioMaxPacketSize = 32;

/** Fixed MakeCode prefix length: type (1) + system time (4) + serial (4). */
inline constexpr uint32_t kRadioPacketPrefixLength = 9;

/** Largest typed payload, MakeCode `MAX_PAYLOAD_LENGTH`. */
inline constexpr uint32_t kRadioMaxPayloadLength = 20;

/** Largest value-pair name in bytes, MakeCode `MAX_FIELD_DOUBLE_NAME_LENGTH`. */
inline constexpr uint32_t kRadioMaxFieldNameLength = 8;

/** Offset of the VALUE packet's name length byte. */
inline constexpr uint32_t kRadioValueNameLenOffset = 13;

/** Offset of the DOUBLE_VALUE packet's name length byte. */
inline constexpr uint32_t kRadioDoubleValueNameLenOffset = 17;

/**
 * Classifies a numeric payload as an integer (NUMBER / VALUE, Int32LE on the
 * wire) or non-integer (DOUBLE / DOUBLE_VALUE, Float64LE), mirroring MakeCode's
 * `value === (value | 0)` predicate: an integer is finite, in the signed-32-bit
 * range, and whole.
 */
inline bool radioNumberIsInteger(mc_number_t value) {
  if (value != value || value - value != 0.0f) {
    return false;
  }
  if (value < -2147483648.0f || value >= 2147483648.0f) {
    return false;
  }
  return value == static_cast<mc_number_t>(static_cast<int32_t>(value));
}

/** A logical packet to encode. Unused fields carry empty values. */
struct RadioFrameInput {
  RadioPacketType type;
  mc_number_t value;
  const uint8_t* name;
  uint32_t nameLen;
  const uint8_t* text;
  uint32_t textLen;
  const uint8_t* bytes;
  uint32_t bytesLen;
};

/** A decoded framed packet; the string/buffer spans borrow from the source frame. */
struct RadioDecodedFrame {
  int type;
  mc_number_t value;
  const uint8_t* name;
  uint32_t nameLen;
  const uint8_t* text;
  uint32_t textLen;
  const uint8_t* bytes;
  uint32_t bytesLen;
  int32_t time;
  int32_t serial;
};

namespace detail {

inline void writeInt32LE(uint8_t* out, int32_t value) {
  const uint32_t u = static_cast<uint32_t>(value);
  out[0] = static_cast<uint8_t>(u & 0xff);
  out[1] = static_cast<uint8_t>((u >> 8) & 0xff);
  out[2] = static_cast<uint8_t>((u >> 16) & 0xff);
  out[3] = static_cast<uint8_t>((u >> 24) & 0xff);
}

inline int32_t readInt32LE(const uint8_t* in) {
  const uint32_t u = static_cast<uint32_t>(in[0]) | (static_cast<uint32_t>(in[1]) << 8) |
                     (static_cast<uint32_t>(in[2]) << 16) | (static_cast<uint32_t>(in[3]) << 24);
  return static_cast<int32_t>(u);
}

inline void writeFloat64LE(uint8_t* out, double value) {
  uint64_t bits;
  std::memcpy(&bits, &value, sizeof(bits));
  for (int i = 0; i < 8; i++) {
    out[i] = static_cast<uint8_t>((bits >> (8 * i)) & 0xff);
  }
}

inline double readFloat64LE(const uint8_t* in) {
  uint64_t bits = 0;
  for (int i = 0; i < 8; i++) {
    bits |= static_cast<uint64_t>(in[i]) << (8 * i);
  }
  double value;
  std::memcpy(&value, &bits, sizeof(value));
  return value;
}

/** Writes a length-prefixed string at `offset` (length byte then bytes), truncated to `maxBytes`.
 */
inline void writeLengthPrefixedString(uint8_t* frame, uint32_t offset, const uint8_t* bytes,
                                      uint32_t length, uint32_t maxBytes) {
  const uint32_t capped = length < maxBytes ? length : maxBytes;
  frame[offset] = static_cast<uint8_t>(capped);
  for (uint32_t i = 0; i < capped; i++) {
    frame[offset + 1 + i] = bytes[i];
  }
}

} // namespace detail

/**
 * Encodes a framed MakeCode packet to its 32-byte on-air frame, byte-for-byte
 * the MakeCode layout. The numeric payload follows {@link radioNumberIsInteger}
 * (Int32LE for NUMBER/VALUE, Float64LE for DOUBLE/DOUBLE_VALUE); strings and
 * buffers are length-prefixed and truncated. `frameOut` must hold
 * {@link kRadioMaxPacketSize} bytes; it is fully overwritten.
 */
inline void encodeRadioFrame(const RadioFrameInput& in, int32_t time, int32_t serial,
                             uint8_t* frameOut) {
  std::memset(frameOut, 0, kRadioMaxPacketSize);
  frameOut[0] = static_cast<uint8_t>(in.type);
  detail::writeInt32LE(frameOut + 1, time);
  detail::writeInt32LE(frameOut + 5, serial);
  switch (in.type) {
  case RadioPacketType::Number:
  case RadioPacketType::Value:
    detail::writeInt32LE(frameOut + kRadioPacketPrefixLength, static_cast<int32_t>(in.value));
    break;
  case RadioPacketType::Double:
  case RadioPacketType::DoubleValue:
    detail::writeFloat64LE(frameOut + kRadioPacketPrefixLength, static_cast<double>(in.value));
    break;
  case RadioPacketType::String:
    detail::writeLengthPrefixedString(frameOut, kRadioPacketPrefixLength, in.text, in.textLen,
                                      kRadioMaxPayloadLength - 1);
    break;
  case RadioPacketType::Buffer: {
    const uint32_t capped =
        in.bytesLen < kRadioMaxPayloadLength - 1 ? in.bytesLen : kRadioMaxPayloadLength - 1;
    frameOut[kRadioPacketPrefixLength] = static_cast<uint8_t>(capped);
    for (uint32_t i = 0; i < capped; i++) {
      frameOut[kRadioPacketPrefixLength + 1 + i] = in.bytes[i];
    }
    break;
  }
  }
  if (in.type == RadioPacketType::Value) {
    detail::writeLengthPrefixedString(frameOut, kRadioValueNameLenOffset, in.name, in.nameLen,
                                      kRadioMaxFieldNameLength);
  } else if (in.type == RadioPacketType::DoubleValue) {
    detail::writeLengthPrefixedString(frameOut, kRadioDoubleValueNameLenOffset, in.name, in.nameLen,
                                      kRadioMaxFieldNameLength);
  }
}

/**
 * Decodes a MakeCode on-air frame, narrowing numeric payloads to f32. The
 * `name`/`text`/`bytes` spans borrow from `frame`, which must hold
 * {@link kRadioMaxPacketSize} bytes and outlive the result.
 */
inline RadioDecodedFrame decodeRadioFrame(const uint8_t* frame) {
  RadioDecodedFrame out{};
  out.type = frame[0];
  out.time = detail::readInt32LE(frame + 1);
  out.serial = detail::readInt32LE(frame + 5);
  const RadioPacketType type = static_cast<RadioPacketType>(frame[0]);
  switch (type) {
  case RadioPacketType::Number:
  case RadioPacketType::Value:
    out.value = static_cast<mc_number_t>(detail::readInt32LE(frame + kRadioPacketPrefixLength));
    break;
  case RadioPacketType::Double:
  case RadioPacketType::DoubleValue:
    out.value = static_cast<mc_number_t>(detail::readFloat64LE(frame + kRadioPacketPrefixLength));
    break;
  case RadioPacketType::String:
    out.textLen = frame[kRadioPacketPrefixLength];
    out.text = frame + kRadioPacketPrefixLength + 1;
    break;
  case RadioPacketType::Buffer:
    out.bytesLen = frame[kRadioPacketPrefixLength];
    out.bytes = frame + kRadioPacketPrefixLength + 1;
    break;
  }
  if (type == RadioPacketType::Value) {
    out.nameLen = frame[kRadioValueNameLenOffset];
    out.name = frame + kRadioValueNameLenOffset + 1;
  } else if (type == RadioPacketType::DoubleValue) {
    out.nameLen = frame[kRadioDoubleValueNameLenOffset];
    out.name = frame + kRadioDoubleValueNameLenOffset + 1;
  }
  return out;
}

} // namespace mindcraft
