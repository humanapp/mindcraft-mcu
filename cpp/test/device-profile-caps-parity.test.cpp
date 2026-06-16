#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

#include "doctest/doctest.h"
#include "fixture-paths.h"
#include "targets/microbit-v2/abi/device-profile.h"

using mindcraft::kMicroBitV2DeviceProfileCaps;

namespace {

// Decodes the committed device-profile cap table emitted by
// packages/wodal/src/targets/microbit-v2/mindcraft/device-profile-caps-vectors.spec.ts:
//   magic 'M' 'C' 'C' '1' | varuint count | count * (varuint nameLen, name
//   bytes, varuint value)
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

  std::string str() {
    const uint32_t length = varuint();
    std::string out;
    out.reserve(length);
    for (uint32_t i = 0; i < length; i++) {
      out.push_back(static_cast<char>(u8()));
    }
    return out;
  }
};

std::vector<uint8_t> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  REQUIRE_MESSAGE(in.good(), "missing fixture: " << path);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)),
                              std::istreambuf_iterator<char>());
}

// The microbit-v2 caps field matching `name`, or -1 when the name is unknown.
int64_t capValue(const std::string& name) {
  if (name == "defaultBudget") {
    return kMicroBitV2DeviceProfileCaps.defaultBudget;
  }
  if (name == "hookBudget") {
    return kMicroBitV2DeviceProfileCaps.hookBudget;
  }
  if (name == "maxFibers") {
    return kMicroBitV2DeviceProfileCaps.maxFibers;
  }
  if (name == "maxStackSize") {
    return kMicroBitV2DeviceProfileCaps.maxStackSize;
  }
  if (name == "maxLocalsSize") {
    return kMicroBitV2DeviceProfileCaps.maxLocalsSize;
  }
  if (name == "maxFrameDepth") {
    return kMicroBitV2DeviceProfileCaps.maxFrameDepth;
  }
  if (name == "maxHandlers") {
    return kMicroBitV2DeviceProfileCaps.maxHandlers;
  }
  return -1;
}

} // namespace

TEST_CASE("microbit-v2 caps equal the wodal device profile") {
  const std::string path =
      std::string(mindcraft::test::kWodalFixturesDir) + "/device-profile-caps-vectors.bin";
  const std::vector<uint8_t> buf = readFile(path);
  Cursor cursor{buf};

  REQUIRE(cursor.u8() == 0x4d); // 'M'
  REQUIRE(cursor.u8() == 0x43); // 'C'
  REQUIRE(cursor.u8() == 0x43); // 'C'
  REQUIRE(cursor.u8() == 0x31); // '1'

  const uint32_t count = cursor.varuint();
  CHECK(count == 7u);
  for (uint32_t i = 0; i < count; i++) {
    const std::string name = cursor.str();
    const uint32_t value = cursor.varuint();
    const int64_t expected = capValue(name);
    CHECK_MESSAGE(expected >= 0, "profile declares an unknown cap: " << name);
    CHECK_MESSAGE(static_cast<int64_t>(value) == expected,
                  "cap mismatch for " << name << ": profile " << value << " vs C++ " << expected);
  }
  CHECK(cursor.pos == buf.size());
}
