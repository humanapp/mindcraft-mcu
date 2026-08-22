#include <cstdint>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "doctest/doctest.h"
#include "fixture-paths.h"

#include "codal/device-port.h"
#include "core/runtime/mc-number.h"

namespace {

// Decodes the committed accelerometer read-back table emitted by
// packages/wodal/src/targets/microbit-v2/wendoo/accelerometer-read-vectors.spec.ts
// (that spec documents the full byte layout): a magic header, a tick count, and
// per tick a setpoint mask, the masked setpoints, and the eight-field read-back.
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

  int32_t i32() {
    uint32_t value = 0;
    for (uint32_t i = 0; i < 4; i++) {
      value |= static_cast<uint32_t>(u8()) << (8 * i);
    }
    return static_cast<int32_t>(value);
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

std::vector<uint8_t> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  REQUIRE_MESSAGE(in.good(), "missing fixture: " << path);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)),
                              std::istreambuf_iterator<char>());
}

// Mask bits matching the wodal fixture's setMask.
constexpr uint8_t kSetGesture = 1 << 0;
constexpr uint8_t kSetSample = 1 << 1;
constexpr uint8_t kSetPitch = 1 << 2;
constexpr uint8_t kSetRoll = 1 << 3;

// Whole degrees for a radian orientation, matching CODAL's
// int getPitch() { return (int)((360.0f*radians)/(2.0f*(float)PI)); }.
int32_t degreesFromRadians(wendoo::mc_number_t radians) {
  const float twoPi = 2.0f * static_cast<float>(3.141592653589793);
  return static_cast<int32_t>((360.0f * radians) / twoPi);
}

// Host-side injectable accelerometer port: radians are the primary orientation
// reading and degrees derive from them, mirroring CODAL. Other reads return
// their held field, initialized to the wodal Accelerometer's resting defaults.
struct SettableAccelerometer : wendoo::AccelerometerInputPort {
  int32_t gesture = 0;
  int32_t x = 0;
  int32_t y = 0;
  int32_t z = -1000;
  wendoo::mc_number_t pitchRadians = 0;
  wendoo::mc_number_t rollRadians = 0;

  uint16_t getGesture() override { return static_cast<uint16_t>(gesture); }
  int32_t getX() override { return x; }
  int32_t getY() override { return y; }
  int32_t getZ() override { return z; }
  int32_t getPitch() override { return degreesFromRadians(pitchRadians); }
  int32_t getRoll() override { return degreesFromRadians(rollRadians); }
  wendoo::mc_number_t getPitchRadians() override { return pitchRadians; }
  wendoo::mc_number_t getRollRadians() override { return rollRadians; }
};

} // namespace

TEST_CASE("accelerometer port read-back matches the wodal schedule") {
  const std::string path =
      std::string(wendoo::test::kWodalFixturesDir) + "/accelerometer-read-vectors.bin";
  const std::vector<uint8_t> buf = readFile(path);
  Cursor cursor{buf};

  REQUIRE(cursor.u8() == 0x4d); // 'M'
  REQUIRE(cursor.u8() == 0x41); // 'A'
  REQUIRE(cursor.u8() == 0x56); // 'V'
  REQUIRE(cursor.u8() == 0x31); // '1'

  const uint32_t tickCount = cursor.varuint();
  REQUIRE(tickCount > 0u);

  SettableAccelerometer accelerometer;
  wendoo::AccelerometerInputPort& port = accelerometer;

  for (uint32_t tick = 0; tick < tickCount; tick++) {
    const uint8_t mask = cursor.u8();
    if (mask & kSetGesture) {
      accelerometer.gesture = cursor.i32();
    }
    if (mask & kSetSample) {
      accelerometer.x = cursor.i32();
      accelerometer.y = cursor.i32();
      accelerometer.z = cursor.i32();
    }
    if (mask & kSetPitch) {
      accelerometer.pitchRadians = cursor.f32();
    }
    if (mask & kSetRoll) {
      accelerometer.rollRadians = cursor.f32();
    }

    const int32_t gesture = cursor.i32();
    const int32_t x = cursor.i32();
    const int32_t y = cursor.i32();
    const int32_t z = cursor.i32();
    const int32_t pitch = cursor.i32();
    const float pitchRadians = cursor.f32();
    const int32_t roll = cursor.i32();
    const float rollRadians = cursor.f32();

    CHECK_MESSAGE(static_cast<int32_t>(port.getGesture()) == gesture,
                  "gesture mismatch at tick " << tick);
    CHECK_MESSAGE(port.getX() == x, "x mismatch at tick " << tick);
    CHECK_MESSAGE(port.getY() == y, "y mismatch at tick " << tick);
    CHECK_MESSAGE(port.getZ() == z, "z mismatch at tick " << tick);
    CHECK_MESSAGE(port.getPitch() == pitch, "pitch mismatch at tick " << tick);
    CHECK_MESSAGE(port.getPitchRadians() == pitchRadians,
                  "pitch radians mismatch at tick " << tick);
    CHECK_MESSAGE(port.getRoll() == roll, "roll mismatch at tick " << tick);
    CHECK_MESSAGE(port.getRollRadians() == rollRadians, "roll radians mismatch at tick " << tick);
  }

  CHECK(cursor.pos == buf.size());
}
