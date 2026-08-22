#include "doctest/doctest.h"

#include <cstdint>
#include <cstring>
#include <string>

#include "codal/radio-wire.h"

// Mirrors the wire-format unit tests in wodal
// packages/wodal/src/core/radio.spec.ts. Pins the MakeCode byte-for-byte interop
// contract (encode matches the pxt-common-packages libs/radio layout; decode
// reads it back, narrowing numerics to f32). The receive ring's per-cursor /
// non-consuming / overflow-snap / group-filter behavior is covered end to end by
// the radio-receive parity goldens in trace-parity.test.cpp.

namespace {

using wendoo::decodeRadioFrame;
using wendoo::encodeRadioFrame;
using wendoo::kRadioMaxPacketSize;
using wendoo::RadioFrameInput;
using wendoo::radioNumberIsInteger;
using wendoo::RadioPacketType;

RadioFrameInput numberInput(wendoo::mc_number_t value) {
  RadioFrameInput in{};
  in.type = RadioPacketType::Number;
  in.value = value;
  return in;
}

const uint8_t* asBytes(const char* s) { return reinterpret_cast<const uint8_t*>(s); }

} // namespace

TEST_CASE("radioNumberIsInteger mirrors MakeCode's value === (value | 0) predicate") {
  CHECK(radioNumberIsInteger(0));
  CHECK(radioNumberIsInteger(42));
  CHECK(radioNumberIsInteger(-7));
  CHECK_FALSE(radioNumberIsInteger(3.5f));
  CHECK_FALSE(radioNumberIsInteger(2147483648.0f)); // overflows int32, so DOUBLE
}

TEST_CASE("a NUMBER frame matches the MakeCode layout byte-for-byte") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::Number;
  in.value = 42;
  encodeRadioFrame(in, 1000, 0, frame);
  CHECK(frame[0] == 0);
  // system time 1000 = 0x3e8 (Int32LE @ 1)
  CHECK(frame[1] == 0xe8);
  CHECK(frame[2] == 0x03);
  CHECK(frame[3] == 0x00);
  CHECK(frame[4] == 0x00);
  // serial 0 @ 5
  CHECK(frame[5] == 0x00);
  // payload 42 (Int32LE @ 9)
  CHECK(frame[9] == 42);
  CHECK(frame[10] == 0);
}

TEST_CASE("a DOUBLE frame carries a Float64LE payload at offset 9") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::Double;
  in.value = 3.5f;
  encodeRadioFrame(in, 0, 0, frame);
  CHECK(frame[0] == 4);
  double payload;
  std::memcpy(&payload, frame + 9, sizeof(payload));
  CHECK(payload == 3.5);
}

TEST_CASE("a STRING frame is length-prefixed UTF-8 at offset 9") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::String;
  in.text = asBytes("hi");
  in.textLen = 2;
  encodeRadioFrame(in, 0, 0, frame);
  CHECK(frame[0] == 2);
  CHECK(frame[9] == 2); // length byte
  CHECK(frame[10] == 0x68);
  CHECK(frame[11] == 0x69);
}

TEST_CASE("a VALUE frame carries Int32LE at 9 and a name length-prefixed at offset 13") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::Value;
  in.value = 5;
  in.name = asBytes("x");
  in.nameLen = 1;
  encodeRadioFrame(in, 0, 0, frame);
  CHECK(frame[0] == 1);
  CHECK(frame[9] == 5);
  CHECK(frame[13] == 1);    // name length
  CHECK(frame[14] == 0x78); // "x"
}

TEST_CASE("a DOUBLE_VALUE frame carries Float64LE at 9 and a name length-prefixed at offset 17") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::DoubleValue;
  in.value = 1.5f;
  in.name = asBytes("yy");
  in.nameLen = 2;
  encodeRadioFrame(in, 0, 0, frame);
  CHECK(frame[0] == 5);
  double payload;
  std::memcpy(&payload, frame + 9, sizeof(payload));
  CHECK(payload == 1.5);
  CHECK(frame[17] == 2); // name length
  CHECK(frame[18] == 0x79);
  CHECK(frame[19] == 0x79);
}

TEST_CASE("a BUFFER frame is length-prefixed bytes at offset 9, truncated to 19") {
  uint8_t frame[kRadioMaxPacketSize];
  uint8_t payload[25];
  for (uint8_t i = 0; i < 25; i++) {
    payload[i] = static_cast<uint8_t>(i + 1);
  }
  RadioFrameInput in{};
  in.type = RadioPacketType::Buffer;
  in.bytes = payload;
  in.bytesLen = 25;
  encodeRadioFrame(in, 0, 0, frame);
  CHECK(frame[0] == 3);
  CHECK(frame[9] == 19); // capped at MAX_PAYLOAD_LENGTH - 1
  CHECK(frame[10] == 1);
  CHECK(frame[28] == 19);
}

TEST_CASE("an over-long VALUE name truncates to 8 bytes") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::Value;
  in.name = asBytes("abcdefghij");
  in.nameLen = 10;
  encodeRadioFrame(in, 0, 0, frame);
  CHECK(frame[13] == 8);
}

TEST_CASE("decode reads back an encoded NUMBER, narrowing to f32") {
  uint8_t frame[kRadioMaxPacketSize];
  encodeRadioFrame(numberInput(1234), 50, 0, frame);
  const wendoo::RadioDecodedFrame decoded = decodeRadioFrame(frame);
  CHECK(decoded.type == 0);
  CHECK(decoded.value == 1234.0f);
  CHECK(decoded.time == 50);
}

TEST_CASE("decode narrows a DOUBLE payload to f32") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::Double;
  in.value = 0.1f;
  encodeRadioFrame(in, 0, 0, frame);
  const wendoo::RadioDecodedFrame decoded = decodeRadioFrame(frame);
  CHECK(decoded.value == 0.1f);
}

TEST_CASE("decode reads back a VALUE name and number") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::Value;
  in.value = 9;
  in.name = asBytes("ax");
  in.nameLen = 2;
  encodeRadioFrame(in, 0, 0, frame);
  const wendoo::RadioDecodedFrame decoded = decodeRadioFrame(frame);
  CHECK(decoded.value == 9.0f);
  CHECK(decoded.nameLen == 2);
  CHECK(std::string(reinterpret_cast<const char*>(decoded.name), decoded.nameLen) == "ax");
}

TEST_CASE("decode reads back a STRING payload") {
  uint8_t frame[kRadioMaxPacketSize];
  RadioFrameInput in{};
  in.type = RadioPacketType::String;
  in.text = asBytes("hello");
  in.textLen = 5;
  encodeRadioFrame(in, 0, 0, frame);
  const wendoo::RadioDecodedFrame decoded = decodeRadioFrame(frame);
  CHECK(std::string(reinterpret_cast<const char*>(decoded.text), decoded.textLen) == "hello");
}

TEST_CASE("a fixed MakeCode NUMBER byte sequence decodes to the expected value") {
  uint8_t bytes[kRadioMaxPacketSize] = {};
  bytes[0] = 0; // NUMBER
  bytes[1] = 0x02;
  bytes[2] = 0x01; // time 0x102
  bytes[9] = 0x07; // value 7
  const wendoo::RadioDecodedFrame decoded = decodeRadioFrame(bytes);
  CHECK(decoded.value == 7.0f);
  CHECK(decoded.time == 0x102);
}
