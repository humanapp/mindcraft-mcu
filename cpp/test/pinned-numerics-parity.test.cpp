#include <cstdint>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "core/platform/span.h"
#include "core/runtime/binary32-transcendental.h"
#include "core/runtime/core-func-id.h"
#include "core/runtime/core-host-functions.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "doctest/doctest.h"
#include "fixture-paths.h"

using namespace wendoo;

namespace {

// The committed pinned-numeric vectors and this consumer share the 6c
// content-only, f32-profile encoding (see pinned-numerics-vectors.spec.ts):
//   0x01 nil | 0x02 bool b | 0x03 number <f32 LE bits> | 0x04 string <ulen><bytes>

std::vector<uint8_t> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  REQUIRE_MESSAGE(in.good(), "missing fixture: " << path);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)),
                              std::istreambuf_iterator<char>());
}

struct Cursor {
  const std::vector<uint8_t>& buf;
  size_t pos = 0;

  uint8_t u8() { return buf[pos++]; }

  uint32_t varuint() {
    uint32_t value = 0;
    uint32_t shift = 0;
    while (true) {
      const uint8_t byte = u8();
      value |= static_cast<uint32_t>(byte & 0x7f) << shift;
      if ((byte & 0x80) == 0) {
        break;
      }
      shift += 7;
    }
    return value;
  }

  float f32() {
    uint32_t bits = 0;
    for (uint32_t i = 0; i < 4; i++) {
      bits |= static_cast<uint32_t>(u8()) << (8 * i);
    }
    float f = 0;
    memcpy(&f, &bits, 4);
    return f;
  }
};

void encVaruint(std::vector<uint8_t>& out, uint32_t value) {
  while (value >= 0x80) {
    out.push_back(static_cast<uint8_t>((value & 0x7f) | 0x80));
    value >>= 7;
  }
  out.push_back(static_cast<uint8_t>(value));
}

void encNumber(std::vector<uint8_t>& out, float f) {
  out.push_back(0x03);
  uint32_t bits = 0;
  memcpy(&bits, &f, 4);
  if (f != f) {
    bits = 0x7fc00000; // canonical NaN, matching the emitter
  }
  for (uint32_t i = 0; i < 4; i++) {
    out.push_back(static_cast<uint8_t>((bits >> (8 * i)) & 0xff));
  }
}

void encString(std::vector<uint8_t>& out, const char* bytes, uint32_t length) {
  out.push_back(0x04);
  encVaruint(out, length);
  for (uint32_t i = 0; i < length; i++) {
    out.push_back(static_cast<uint8_t>(bytes[i]));
  }
}

void encodeValue(const ManagedHeap& heap, const Value& v, std::vector<uint8_t>& out) {
  if (v.isNil()) {
    out.push_back(0x01);
  } else if (v.isBoolean()) {
    out.push_back(0x02);
    out.push_back(v.asBoolean() ? 1 : 0);
  } else if (v.isNumber()) {
    encNumber(out, v.asNumber());
  } else if (v.isString()) {
    const char* bytes = nullptr;
    uint32_t length = 0;
    REQUIRE(heap.stringContent(v, bytes, length));
    encString(out, bytes, length);
  } else {
    FAIL("pinned-numeric consumer: unencodable output value tag");
  }
}

Value decodeValue(Cursor& cur, ManagedHeap& heap) {
  const uint8_t tag = cur.u8();
  switch (tag) {
  case 0x01:
    return kNilValue;
  case 0x02:
    return Value::boolean(cur.u8() != 0);
  case 0x03:
    return Value::number(cur.f32());
  case 0x04: {
    const uint32_t length = cur.varuint();
    const char* bytes = reinterpret_cast<const char*>(cur.buf.data()) + cur.pos;
    cur.pos += length;
    Value out;
    REQUIRE(heap.newString(bytes, length, nullptr, out));
    return out;
  }
  default:
    FAIL("pinned-numeric consumer: unknown encoded tag");
    return kNilValue;
  }
}

void skipValue(Cursor& cur) {
  const uint8_t tag = cur.u8();
  switch (tag) {
  case 0x01:
    return;
  case 0x02:
    cur.u8();
    return;
  case 0x03:
    cur.pos += 4;
    return;
  case 0x04:
    cur.pos += cur.varuint();
    return;
  default:
    FAIL("pinned-numeric consumer: unknown encoded tag in skip");
  }
}

std::string hex(const uint8_t* bytes, size_t length) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < length; i++) {
    out.push_back(digits[bytes[i] >> 4]);
    out.push_back(digits[bytes[i] & 0x0f]);
  }
  return out;
}

} // namespace

TEST_CASE("the pinned-numeric translation unit rounds per operation (no FMA contraction)") {
  CHECK(binary32::multiplyAddRoundsTwice());
}

TEST_CASE("every committed pinned-numeric vector byte-matches the C++ body") {
  const std::string path =
      std::string(wendoo::test::kWodalFixturesDir) + "/pinned-numerics-vectors.bin";
  const std::vector<uint8_t> buf = readFile(path);

  Cursor cur{buf, 0};
  REQUIRE(cur.u8() == 'M');
  REQUIRE(cur.u8() == 'C');
  REQUIRE(cur.u8() == 'V');
  REQUIRE(cur.u8() == '1');
  const uint32_t recordCount = cur.varuint();
  REQUIRE(recordCount > 0);

  std::vector<uint8_t> storage(8 * 1024 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);

  for (uint32_t r = 0; r < recordCount; r++) {
    const uint32_t funcId = cur.varuint();
    const uint32_t argc = cur.varuint();
    std::vector<Value> args;
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
      args.push_back(decodeValue(cur, heap));
    }
    const size_t expectedStart = cur.pos;
    skipValue(cur);
    const size_t expectedEnd = cur.pos;

    const HostCallEnv env{&heap, nullptr, nullptr};
    Value out;
    const Status status = callCoreHostFunction(
        static_cast<CoreFuncId>(funcId), Span<const Value>(args.data(), args.size()), env, out);

    INFO("record " << r << " funcId " << funcId);
    REQUIRE(status.isOk());

    std::vector<uint8_t> encoded;
    encodeValue(heap, out, encoded);

    const size_t expectedLen = expectedEnd - expectedStart;
    INFO("expected " << hex(buf.data() + expectedStart, expectedLen) << " got "
                     << hex(encoded.data(), encoded.size()));
    CHECK(encoded.size() == expectedLen);
    CHECK(memcmp(encoded.data(), buf.data() + expectedStart, expectedLen) == 0);
  }
}
