#include "doctest/doctest.h"

#include "codal/device-port.h"
#include "codal/fault-mode.h"
#include "codal/host-loop.h"
#include "core/codec/program-reader.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/load-error.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "device-profile-caps.h"
#include "fixture-paths.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <array>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

using mindcraft::BrainRuntime;
using mindcraft::ByteSpan;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FaultDomain;
using mindcraft::FiberScheduler;
using mindcraft::formatFaultCode;
using mindcraft::HostLoop;
using mindcraft::kFaultCodeSize;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::LoadError;
using mindcraft::ProgramImage;
using mindcraft::ProgramReaderOptions;
using mindcraft::RegionArena;
using mindcraft::Result;
using mindcraft::RuntimeSurface;
using mindcraft::showFaultPass;
using mindcraft::Span;
using mindcraft::Value;

namespace {

std::vector<uint8_t> readBinaryFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

/** Fault display stub recording the policy's calls without rendering. */
struct RecordingFaultDisplay : mindcraft::FaultDisplayPort {
  int faceShown = 0;
  std::vector<std::string> scrolled;

  void showFaultFace() override { faceShown++; }
  void scrollFaultCode(const char* code) override { scrolled.push_back(code); }
};

/** No-op display: the fault tests never reach the brain's display port. */
struct NullDisplay : mindcraft::PixelDisplayPort {
  void setPixel(int16_t, int16_t, uint8_t) override {}
  void scrollText(const uint8_t*, uint32_t, uint32_t, mindcraft::mc_number_t,
                  mindcraft::AsyncHandle) override {}
  void drawFrames(mindcraft::DrawFrameSource&, uint32_t, mindcraft::mc_number_t,
                  mindcraft::AsyncHandle) override {}
  void preempt() override {}
  void clear() override {}
  int getLightLevel() override { return 128; }
};

/** No-op buttons: never pressed. */
struct NullButtons : mindcraft::ButtonInputPort {
  bool isPressed(uint8_t) override { return false; }
};

/** No-op accelerometer: at rest, no gesture. */
struct NullAccelerometer : mindcraft::AccelerometerInputPort {
  uint16_t getGesture() override { return 0; }
  int32_t getX() override { return 0; }
  int32_t getY() override { return 0; }
  int32_t getZ() override { return 0; }
  int32_t getPitch() override { return 0; }
  int32_t getRoll() override { return 0; }
  mindcraft::mc_number_t getPitchRadians() override { return 0; }
  mindcraft::mc_number_t getRollRadians() override { return 0; }
};

struct NullI2C : mindcraft::I2CPort {
  int write(uint16_t, const uint8_t*, int) override { return 0; }
  int read(uint16_t, uint8_t*, int) override { return 0; }
};

struct NullGpio : mindcraft::GPIOPort {
  int digitalRead(int) override { return 0; }
  int digitalWrite(int, int) override { return 0; }
  int setPull(int, int) override { return 0; }
  int setServo(int, int) override { return 0; }
  int analogRead(int) override { return 0; }
};

struct NullSonar : mindcraft::SonarPort {
  int distance(int, int) override { return 0; }
};

/** Radio port that drops sends and never receives. */
struct NullRadio : mindcraft::RadioPort {
  mindcraft::RadioPacketView empty{};
  void send(const mindcraft::RadioSendView&) override {}
  uint8_t group() override { return 0; }
  void setGroup(int) override {}
  void setTransmitPower(int) override {}
  void setFrequencyBand(int) override {}
  uint32_t ringSize() override { return 0; }
  const mindcraft::RadioPacketView& ringAt(uint32_t) override { return empty; }
  int headSequence() override { return 0; }
};

/** Speaker port that resolves every play at once and never leases. */
struct NullSpeaker : mindcraft::SpeakerPort {
  void playSoundEmoji(const uint8_t*, uint32_t, mindcraft::mc_number_t,
                      mindcraft::AsyncHandle handle) override {
    handle.resolve(mindcraft::kVoidValue);
  }
  void preempt() override {}
};

/** Clock returning a fixed reading. */
struct FixedClock : mindcraft::MonotonicClockPort {
  uint32_t now = 0;
  uint32_t uptimeMillis() override { return now; }
};

std::string fixtureBase() {
  return std::string(mindcraft::test::kWodalFixturesDir) + "/button-display";
}

} // namespace

TEST_CASE("formatFaultCode renders the stable domain-prefixed decimal code") {
  char buffer[kFaultCodeSize];

  formatFaultCode(buffer, FaultDomain::Load, 3);
  CHECK(std::string(buffer) == "L3");

  formatFaultCode(buffer, FaultDomain::Runtime, 5);
  CHECK(std::string(buffer) == "E5");

  formatFaultCode(buffer, FaultDomain::Load, 0);
  CHECK(std::string(buffer) == "L0");

  // The widest code the buffer must hold.
  formatFaultCode(buffer, FaultDomain::Runtime, 65535);
  CHECK(std::string(buffer) == "E65535");
}

TEST_CASE("a corrupted program faults at load and the policy drives the fault display") {
  std::vector<uint8_t> wire = readBinaryFile(fixtureBase() + ".mcprogram.bin");
  REQUIRE_FALSE(wire.empty());
  // Corrupt the leading magic so the reader rejects the image.
  wire[0] = static_cast<uint8_t>(wire[0] ^ 0xff);

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE_FALSE(decoded.isOk());
  CHECK(decoded.error() == LoadError::InvalidMagic);

  // The board-agnostic load-fault policy: format the stable code, then enter
  // the show-the-error loop (one pass exercised here; the firmware repeats it).
  RecordingFaultDisplay faultDisplay;
  char code[kFaultCodeSize];
  formatFaultCode(code, FaultDomain::Load, static_cast<uint16_t>(decoded.error()));
  showFaultPass(faultDisplay, code);

  CHECK(faultDisplay.faceShown == 1);
  REQUIRE(faultDisplay.scrolled.size() == 1);
  CHECK(faultDisplay.scrolled[0] == "L3");
}

TEST_CASE("the host loop latches fault mode when startup fails") {
  const std::vector<uint8_t> wire = readBinaryFile(fixtureBase() + ".mcprogram.bin");
  // One carve-on-demand arena holds the image and backs the scheduler.
  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  // A surface with no execution context: BrainRuntime::startup faults
  // HostError before activating the page.
  RuntimeSurface surface{nullptr, {}, nullptr};
  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  NullDisplay display;
  NullButtons buttons;
  RecordingFaultDisplay faultDisplay;
  FixedClock clock;
  NullAccelerometer accelerometer;
  NullI2C i2c;
  NullGpio gpio;
  NullSonar sonar;
  NullRadio radio;
  NullSpeaker speaker;
  mindcraft::DevicePorts ports{&display, &buttons, &faultDisplay, &clock, &accelerometer,
                               &i2c,     &gpio,    &sonar,        &radio, &speaker};

  HostLoop hostLoop(brain, ports);
  const mindcraft::Status status = hostLoop.startup();
  CHECK_FALSE(status.isOk());
  REQUIRE(hostLoop.faulted());
  CHECK(hostLoop.faultCode() == ErrorCode::HostError);

  // A faulted loop stops ticking the brain and renders the fault display each
  // tick instead, scrolling the runtime-domain code.
  hostLoop.tick();
  CHECK(faultDisplay.faceShown == 1);
  REQUIRE(faultDisplay.scrolled.size() == 1);
  CHECK(faultDisplay.scrolled[0] == "E3");

  hostLoop.tick();
  CHECK(faultDisplay.faceShown == 2);
}
