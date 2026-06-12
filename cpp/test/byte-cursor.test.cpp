#include "doctest/doctest.h"

#include "core/platform/byte-cursor.h"

#include <cstdint>
#include <cstring>
#include <vector>

using mindcraft::ByteCursor;
using mindcraft::ByteSpan;
using mindcraft::LoadError;

namespace {

ByteCursor cursorOver(const std::vector<uint8_t>& bytes) {
  return ByteCursor(ByteSpan(bytes.data(), bytes.size()));
}

} // namespace

TEST_CASE("readU8 reads bytes and tracks position") {
  const std::vector<uint8_t> bytes{0x01, 0xff};
  ByteCursor cursor = cursorOver(bytes);
  CHECK(cursor.offset() == 0);
  CHECK(cursor.remaining() == 2);
  CHECK_FALSE(cursor.atEnd());

  auto first = cursor.readU8();
  REQUIRE(first.isOk());
  CHECK(first.value() == 0x01);

  auto second = cursor.readU8();
  REQUIRE(second.isOk());
  CHECK(second.value() == 0xff);
  CHECK(cursor.atEnd());
}

TEST_CASE("readU8 fails Truncated at the end of the buffer") {
  const std::vector<uint8_t> bytes{};
  ByteCursor cursor = cursorOver(bytes);
  auto result = cursor.readU8();
  REQUIRE_FALSE(result.isOk());
  CHECK(result.error() == LoadError::Truncated);
}

TEST_CASE("readVarUint decodes ULEB128 values") {
  const std::vector<uint8_t> bytes{
      0x00,                         // 0
      0x7f,                         // 127
      0x80, 0x01,                   // 128
      0xac, 0x02,                   // 300
      0xff, 0xff, 0xff, 0x7f,       // 2^28 - 1 (4-byte max)
      0x80, 0x80, 0x80, 0x80, 0x01, // 2^28 (first 5-byte value)
      0xff, 0xff, 0xff, 0xff, 0x0f, // 2^32 - 1 (5-byte max)
  };
  ByteCursor cursor = cursorOver(bytes);
  const uint32_t expected[] = {0, 127, 128, 300, 0x0fffffff, 0x10000000, 0xffffffff};
  for (uint32_t want : expected) {
    auto result = cursor.readVarUint();
    REQUIRE(result.isOk());
    CHECK(result.value() == want);
  }
  CHECK(cursor.atEnd());
}

TEST_CASE("readVarUint rejects payload bits above bit 31") {
  const std::vector<uint8_t> bytes{0x80, 0x80, 0x80, 0x80, 0x10};
  ByteCursor cursor = cursorOver(bytes);
  auto result = cursor.readVarUint();
  REQUIRE_FALSE(result.isOk());
  CHECK(result.error() == LoadError::VarIntOverflow);
}

TEST_CASE("readVarUint rejects a continuation flag on the 5th byte") {
  // Payload bits fit a u32, but the continuation flag demands a 6th byte.
  const std::vector<uint8_t> bytes{0x80, 0x80, 0x80, 0x80, 0x8f, 0x00};
  ByteCursor cursor = cursorOver(bytes);
  auto result = cursor.readVarUint();
  REQUIRE_FALSE(result.isOk());
  CHECK(result.error() == LoadError::VarIntOverflow);
}

TEST_CASE("readVarUint fails Truncated when the buffer ends mid-encoding") {
  const std::vector<uint8_t> bytes{0x80, 0x80};
  ByteCursor cursor = cursorOver(bytes);
  auto result = cursor.readVarUint();
  REQUIRE_FALSE(result.isOk());
  CHECK(result.error() == LoadError::Truncated);
}

TEST_CASE("readVarInt decodes zigzag values") {
  const std::vector<uint8_t> bytes{
      0x00,                         // 0
      0x01,                         // -1
      0x02,                         // 1
      0x03,                         // -2
      0xfe, 0xff, 0xff, 0xff, 0x0f, // INT32_MAX
      0xff, 0xff, 0xff, 0xff, 0x0f, // INT32_MIN
  };
  ByteCursor cursor = cursorOver(bytes);
  const int32_t expected[] = {0, -1, 1, -2, 2147483647, -2147483647 - 1};
  for (int32_t want : expected) {
    auto result = cursor.readVarInt();
    REQUIRE(result.isOk());
    CHECK(result.value() == want);
  }
  CHECK(cursor.atEnd());
}

TEST_CASE("readVarInt propagates var-uint failures") {
  const std::vector<uint8_t> overflow{0x80, 0x80, 0x80, 0x80, 0x10};
  ByteCursor cursor = cursorOver(overflow);
  auto result = cursor.readVarInt();
  REQUIRE_FALSE(result.isOk());
  CHECK(result.error() == LoadError::VarIntOverflow);
}

TEST_CASE("readF32 assembles little-endian bit patterns") {
  const std::vector<uint8_t> bytes{
      0x00, 0x00, 0x80, 0x3f, // 1.0f
      0x00, 0x00, 0x20, 0xc0, // -2.5f
      0x00, 0x00, 0x00, 0x80, // -0.0f
  };
  ByteCursor cursor = cursorOver(bytes);

  auto one = cursor.readF32();
  REQUIRE(one.isOk());
  CHECK(one.value() == 1.0f);

  auto negative = cursor.readF32();
  REQUIRE(negative.isOk());
  CHECK(negative.value() == -2.5f);

  auto negativeZero = cursor.readF32();
  REQUIRE(negativeZero.isOk());
  CHECK(negativeZero.value() == 0.0f);
  uint32_t bits = 0;
  const float value = negativeZero.value();
  memcpy(&bits, &value, sizeof(bits));
  CHECK(bits == 0x80000000u);
}

TEST_CASE("readF32 fails Truncated on a short payload") {
  const std::vector<uint8_t> bytes{0x00, 0x00, 0x80};
  ByteCursor cursor = cursorOver(bytes);
  auto result = cursor.readF32();
  REQUIRE_FALSE(result.isOk());
  CHECK(result.error() == LoadError::Truncated);
}

TEST_CASE("readBytes returns a borrowed view and advances") {
  const std::vector<uint8_t> bytes{0x10, 0x20, 0x30, 0x40};
  ByteCursor cursor = cursorOver(bytes);

  auto view = cursor.readBytes(3);
  REQUIRE(view.isOk());
  CHECK(view.value().size() == 3);
  CHECK(view.value().data() == bytes.data());
  CHECK(view.value()[2] == 0x30);
  CHECK(cursor.offset() == 3);

  auto empty = cursor.readBytes(0);
  REQUIRE(empty.isOk());
  CHECK(empty.value().size() == 0);

  auto past = cursor.readBytes(2);
  REQUIRE_FALSE(past.isOk());
  CHECK(past.error() == LoadError::Truncated);
}
