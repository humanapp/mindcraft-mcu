#include "doctest/doctest.h"

#include "codal/accelerometer-gesture.h"
#include "codal/device-port.h"
#include "codal/host-loop.h"
#include "codal/shared-type-atom-id.h"
#include "core/codec/program-reader.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/core-host-functions.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/host-actions/core-host-action-bindings.h"
#include "core/runtime/load-error.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/type-registry.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "device-profile-caps.h"
#include "fixture-paths.h"
#include "hostkit/observable-trace.h"
#include "string-sink.h"
#include "targets/microbit-v2/abi/display-scroll.h"
#include "targets/microbit-v2/abi/host-actions/host-action-bindings.h"
#include "targets/microbit-v2/abi/host-functions/host-func-bindings.h"
#include "targets/microbit-v2/abi/native-struct-bindings.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <array>
#include <cstdint>
#include <fstream>
#include <map>
#include <string>
#include <vector>

using mindcraft::BrainRuntime;
using mindcraft::ByteSpan;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FiberScheduler;
using mindcraft::HostLoop;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::kSharedTypeAtomIdCount;
using mindcraft::LoadError;
using mindcraft::ObservableTraceWriter;
using mindcraft::ProgramImage;
using mindcraft::ProgramReaderOptions;
using mindcraft::RegionArena;
using mindcraft::Result;
using mindcraft::RuntimeSurface;
using mindcraft::Span;
using mindcraft::Value;
using mindcraft::VmObserver;

namespace {

std::vector<uint8_t> readBinaryFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

std::string readTextFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

// Whole degrees for a radian orientation, matching CODAL's
// int getPitch() { return (int)((360.0f*radians)/(2.0f*(float)PI)); }.
int32_t degreesFromRadians(mindcraft::mc_number_t radians) {
  const float twoPi = 2.0f * static_cast<float>(3.141592653589793);
  return static_cast<int32_t>((360.0f * radians) / twoPi);
}

/**
 * Host MicroBit stub over the device ports: a 5x5 pixel grid, settable
 * button levels, and a display tap that records each pixel write into the
 * observable trace before it lands.
 */
struct HostMicroBit {
  struct TracingDisplay : mindcraft::PixelDisplayPort {
    ObservableTraceWriter* writer = nullptr;
    uint8_t pixels[5][5] = {};
    // The display lease, shared by the scroll and the timed draw: busy until
    // completionTime, holding active. A scroll or draw requested while busy is
    // dropped; a zero-duration draw pastes and settles without taking it.
    bool busy = false;
    float completionTime = 0;
    mindcraft::AsyncHandle active{};
    // A held image-sequence draw: its frames (each row-major brightness bytes),
    // their sizes, and the playback cursor. Empty while a scroll holds the lease.
    std::vector<std::vector<uint8_t>> seqFrames;
    std::vector<uint32_t> seqWidths;
    std::vector<uint32_t> seqHeights;
    float seqStart = 0;
    uint32_t perFrameMs = 0;
    uint32_t paintedCount = 0;

    // Emit the port draw line and paste a frame top-left (no per-pixel port lines).
    void pasteFrame(const uint8_t* frame, uint32_t width, uint32_t height) {
      if (writer != nullptr) {
        writer->displayDraw(width, height, frame);
      }
      for (uint32_t row = 0; row < height && row < 5; row++) {
        for (uint32_t col = 0; col < width && col < 5; col++) {
          pixels[row][col] = frame[row * width + col];
        }
      }
    }

    void setPixel(int16_t x, int16_t y, uint8_t brightness) override {
      if (writer != nullptr) {
        writer->displaySetPixel(static_cast<float>(x), static_cast<float>(y),
                                static_cast<float>(brightness));
      }
      // The device drops a write outside the matrix (CODAL Image::setPixelValue).
      if (x >= 0 && x < 5 && y >= 0 && y < 5) {
        pixels[y][x] = brightness;
      }
    }

    // Host stub: completion is driven by the pinned formula against logical time
    // (no glyph rendering), so the resume round matches the wodal oracle. A
    // scroll requested while the lease is held is dropped (settled at once, no
    // port line).
    void scrollText(const uint8_t* bytes, uint32_t length, uint32_t delayMs, float requestTimeMs,
                    mindcraft::AsyncHandle handle) override {
      if (busy) {
        handle.resolve(mindcraft::kVoidValue);
        return;
      }
      if (writer != nullptr) {
        writer->displayScroll(bytes, length);
      }
      busy = true;
      completionTime =
          requestTimeMs + static_cast<float>(mindcraft::scrollDurationMs(length, delayMs));
      active = handle;
    }

    // Host stub: paste a clipped frame sequence top-left (no per-pixel port
    // lines). A draw requested while the lease is held is dropped (settled at
    // once, no port line, nothing pasted); a positive per-frame duration holds
    // the lease for the whole sequence; a zero-duration draw paints only the last
    // frame and settles at dispatch without holding it.
    void drawFrames(mindcraft::DrawFrameSource& frames, uint32_t perFrameDurationMs,
                    float requestTimeMs, mindcraft::AsyncHandle handle) override {
      if (busy) {
        handle.resolve(mindcraft::kVoidValue);
        return;
      }
      const uint32_t frameCount = frames.frameCount();
      uint8_t buf[5 * 5] = {};
      if (perFrameDurationMs == 0) {
        uint32_t width = 0;
        uint32_t height = 0;
        frames.writeFrame(frameCount - 1, buf, width, height);
        pasteFrame(buf, width, height);
        handle.resolve(mindcraft::kVoidValue);
        return;
      }
      seqFrames.clear();
      seqWidths.clear();
      seqHeights.clear();
      for (uint32_t i = 0; i < frameCount; i++) {
        uint32_t width = 0;
        uint32_t height = 0;
        frames.writeFrame(i, buf, width, height);
        seqFrames.emplace_back(buf, buf + width * height);
        seqWidths.push_back(width);
        seqHeights.push_back(height);
      }
      pasteFrame(seqFrames[0].data(), seqWidths[0], seqHeights[0]);
      busy = true;
      seqStart = requestTimeMs;
      perFrameMs = perFrameDurationMs;
      paintedCount = 1;
      completionTime = requestTimeMs + static_cast<float>(frameCount * perFrameDurationMs);
      active = handle;
    }

    // Advance a held image sequence to the frame due at `now`, then resolve the
    // held scroll or sequence once its lease has elapsed. Mirrors pollDisplay.
    void advanceScroll(float now) {
      if (!busy) {
        return;
      }
      if (!seqFrames.empty()) {
        const uint32_t frameCount = static_cast<uint32_t>(seqFrames.size());
        const int64_t raw = static_cast<int64_t>((now - seqStart) / static_cast<float>(perFrameMs));
        uint32_t target = raw < 0 ? 0 : static_cast<uint32_t>(raw);
        if (target > frameCount - 1) {
          target = frameCount - 1;
        }
        while (paintedCount <= target) {
          pasteFrame(seqFrames[paintedCount].data(), seqWidths[paintedCount],
                     seqHeights[paintedCount]);
          paintedCount++;
        }
      }
      if (now < completionTime) {
        return;
      }
      busy = false;
      seqFrames.clear();
      seqWidths.clear();
      seqHeights.clear();
      active.resolve(mindcraft::kVoidValue);
    }

    // Release the current lease at once, resolving the held op's handle.
    void preempt() override {
      if (!busy) {
        return;
      }
      const mindcraft::AsyncHandle held = active;
      busy = false;
      seqFrames.clear();
      seqWidths.clear();
      seqHeights.clear();
      held.resolve(mindcraft::kVoidValue);
    }
  };

  struct SettableButtons : mindcraft::ButtonInputPort {
    // Index 0 is button A, 1 is button B, 2 is the touch logo.
    bool pressed[3] = {false, false, false};

    bool isPressed(uint8_t buttonIndex) override {
      return buttonIndex < 3 ? pressed[buttonIndex] : false;
    }
  };

  // Injectable accelerometer: radians are the primary orientation reading and
  // degrees derive from them, mirroring CODAL and the wodal Accelerometer model;
  // the other reads return their held field. Resting defaults are zero.
  struct SettableAccelerometer : mindcraft::AccelerometerInputPort {
    int32_t gesture = 0;
    int32_t x = 0;
    int32_t y = 0;
    int32_t z = 0;
    mindcraft::mc_number_t pitchRadians = 0;
    mindcraft::mc_number_t rollRadians = 0;

    uint16_t getGesture() override { return static_cast<uint16_t>(gesture); }
    int32_t getX() override { return x; }
    int32_t getY() override { return y; }
    int32_t getZ() override { return z; }
    int32_t getPitch() override { return degreesFromRadians(pitchRadians); }
    int32_t getRoll() override { return degreesFromRadians(rollRadians); }
    mindcraft::mc_number_t getPitchRadians() override { return pitchRadians; }
    mindcraft::mc_number_t getRollRadians() override { return rollRadians; }
  };

  // Injectable I2C bus: records each write and serves reads from a per-address
  // response a test injects, emitting the port trace line at each transaction.
  // Holds no real hardware; mirrors the wodal I2CBus sim model.
  struct TracingI2C : mindcraft::I2CPort {
    struct Write {
      uint16_t address;
      std::vector<uint8_t> bytes;
    };
    ObservableTraceWriter* writer = nullptr;
    std::vector<Write> writes;
    std::map<uint16_t, std::vector<uint8_t>> readResponses;

    int write(uint16_t address, const uint8_t* data, int len) override {
      const uint32_t count = len > 0 ? static_cast<uint32_t>(len) : 0;
      if (writer != nullptr) {
        writer->i2cWrite(address, data, count);
      }
      writes.push_back({address, std::vector<uint8_t>(data, data + count)});
      return 0;
    }

    int read(uint16_t address, uint8_t* data, int len) override {
      const uint32_t count = len > 0 ? static_cast<uint32_t>(len) : 0;
      const auto it = readResponses.find(address);
      if (it == readResponses.end()) {
        // No-device read: no bytes returned.
        if (writer != nullptr) {
          writer->i2cRead(address, count, data, 0);
        }
        return 1;
      }
      const std::vector<uint8_t>& response = it->second;
      for (uint32_t i = 0; i < count; i++) {
        data[i] = i < response.size() ? response[i] : 0;
      }
      if (writer != nullptr) {
        writer->i2cRead(address, count, data, count);
      }
      return 0;
    }
  };

  // Injectable GPIO pins: records each write, pull, and servo and serves digital
  // reads from a per-pin level a test injects, emitting the port trace line at
  // each call. A pin outside 0-20 is a no-op (a read returns 0) but still traces,
  // mirroring the wodal Gpio sim model.
  struct TracingGpio : mindcraft::GPIOPort {
    struct DigitalWrite {
      int pin;
      int value;
    };
    struct Pull {
      int pin;
      int mode;
    };
    struct Servo {
      int pin;
      int angle;
    };
    static constexpr int kMaxPin = 20;
    ObservableTraceWriter* writer = nullptr;
    std::vector<DigitalWrite> writes;
    std::vector<Pull> pulls;
    std::vector<Servo> servos;
    std::map<int, int> levels;

    static bool validPin(int pin) { return pin >= 0 && pin <= kMaxPin; }

    int digitalRead(int pin) override {
      int value = 0;
      if (validPin(pin)) {
        const auto it = levels.find(pin);
        value = it == levels.end() ? 0 : it->second;
      }
      if (writer != nullptr) {
        writer->gpioDigitalRead(static_cast<uint32_t>(pin), static_cast<uint32_t>(value));
      }
      return value;
    }

    int digitalWrite(int pin, int value) override {
      if (writer != nullptr) {
        writer->gpioDigitalWrite(static_cast<uint32_t>(pin), static_cast<uint32_t>(value));
      }
      if (validPin(pin)) {
        writes.push_back({pin, value});
      }
      return 0;
    }

    int setPull(int pin, int mode) override {
      if (writer != nullptr) {
        writer->gpioSetPull(static_cast<uint32_t>(pin), static_cast<uint32_t>(mode));
      }
      if (validPin(pin)) {
        pulls.push_back({pin, mode});
      }
      return 0;
    }

    int setServo(int pin, int angle) override {
      if (writer != nullptr) {
        writer->gpioServoWrite(static_cast<uint32_t>(pin), static_cast<uint32_t>(angle));
      }
      if (validPin(pin)) {
        servos.push_back({pin, angle});
      }
      return 0;
    }
  };

  struct NullFaultDisplay : mindcraft::FaultDisplayPort {
    void showFaultFace() override {}
    void scrollFaultCode(const char*) override {}
  };

  struct FixedClock : mindcraft::MonotonicClockPort {
    uint32_t now = 0;

    uint32_t uptimeMillis() override { return now; }
  };

  TracingDisplay display;
  SettableButtons buttons;
  SettableAccelerometer accelerometer;
  TracingI2C i2c;
  TracingGpio gpio;
  NullFaultDisplay faultDisplay;
  FixedClock clock;

  mindcraft::DevicePorts ports{&display,       &buttons, &faultDisplay, &clock,
                               &accelerometer, &i2c,     &gpio};
};

/** Forwards the VM's host-binding events into the observable trace. */
struct TraceTap : VmObserver {
  explicit TraceTap(ObservableTraceWriter& writer) : writer(writer) {}

  ObservableTraceWriter& writer;
  bool renderable = true;

  void onHostActionCall(uint32_t actionId, uint32_t callSiteId, Span<const Value> args,
                        const Value& result) override {
    renderable = writer.hostActionCall(actionId, callSiteId, args, result) && renderable;
  }

  void onHostActionCallAsync(uint32_t actionId, uint32_t callSiteId,
                             Span<const Value> args) override {
    renderable = writer.hostActionCallAsync(actionId, callSiteId, args) && renderable;
  }

  void onFiberFault(uint32_t fiberId, ErrorCode code) override { writer.fiberFault(fiberId, code); }
};

/** One scheduled think: an optional button-A level applied before the time advance. */
struct ScheduleStep {
  /** Simulated milliseconds to advance before the think. */
  float advanceMs;

  /** Button A level to apply before the advance: 0 released, 1 pressed, -1 none. */
  int buttonA;
};

// Mirrors PRESS_CYCLES_SCHEDULE in wodal
// packages/wodal/src/targets/microbit-v2/mindcraft/observable-trace.spec.ts,
// the generator of the committed golden trace. The two copies are kept in
// sync by hand; a divergence fails the byte comparison below.
constexpr ScheduleStep kPressCyclesSchedule[10] = {
    {16, -1}, // first eval seeds callsite state, no edge
    {16, -1}, // steady released
    {32, 1},  // press edge fires the rule
    {16, -1}, // held: edge detection does not re-trigger
    {16, -1}, // still held
    {48, 0},  // release: not reported by the default modifier
    {16, -1}, // steady released
    {32, 1},  // second press edge fires the rule again
    {16, 0},  // release again
    {16, -1}, // steady released
};

/**
 * One scheduled think for a button-sensor fixture: button/logo levels applied
 * before the time advance (1 pressed, 0 released, -1 unchanged). Mirrors the
 * ScheduleStep of wodal
 * packages/wodal/src/targets/microbit-v2/mindcraft/button-sensor-trace.spec.ts.
 */
struct ButtonScheduleStep {
  float advanceMs;
  int a;
  int b;
  int logo;
};

/**
 * Loads a button-sensor fixture binary, replays its scripted button schedule
 * through the host loop, and byte-compares the rendered trace against the
 * committed golden.
 */
void runButtonSensorParity(const std::string& name, const ButtonScheduleStep* schedule, int steps) {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/" + name;
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The button sensor backs its per-callsite derivation state on a managed
  // heap; the env hands the body the button port, heap, and roots.
  mindcraft::ManagedHeap heap(arena);
  mindcraft::MicroBitV2ButtonSensorEnv buttonEnv{&microbit.buttons, &heap, nullptr};
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports, nullptr, &buttonEnv);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  buttonEnv.roots = &scheduler;
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < steps; i++) {
    const ButtonScheduleStep& step = schedule[i];
    if (step.a >= 0) {
      microbit.buttons.pressed[0] = step.a == 1;
    }
    if (step.b >= 0) {
      microbit.buttons.pressed[1] = step.b == 1;
    }
    if (step.logo >= 0) {
      microbit.buttons.pressed[2] = step.logo == 1;
    }
    const float timeMs = lastThinkTimeMs + step.advanceMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // Every button-sensor fixture's schedule fires the rule, lighting pixel (0,0).
  CHECK(microbit.display.pixels[0][0] == 255);
}

/** One scheduled think for a gesture fixture: the gesture code injected before the
 * time advance. Mirrors the ScheduleStep of wodal
 * packages/wodal/src/targets/microbit-v2/mindcraft/gesture-sensor-trace.spec.ts. */
struct GestureScheduleStep {
  float advanceMs;
  mindcraft::AccelerometerGesture gesture;
};

/**
 * Loads a gesture fixture binary, replays its scripted gesture schedule through
 * the host loop, and byte-compares the rendered trace against the committed
 * golden. The gesture sensor is stateless and reads the accelerometer port off
 * the device ports.
 */
void runGestureSensorParity(const std::string& name, const GestureScheduleStep* schedule,
                            int steps) {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/" + name;
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  mindcraft::ManagedHeap heap(arena);
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < steps; i++) {
    const GestureScheduleStep& step = schedule[i];
    microbit.accelerometer.gesture = static_cast<int32_t>(step.gesture);
    const float timeMs = lastThinkTimeMs + step.advanceMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // Each gesture fixture's matching gesture fires once, lighting pixel (0,0).
  CHECK(microbit.display.pixels[0][0] == 255);
}

} // namespace

TEST_CASE("the button-display fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/button-display";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".press-cycles.trace");

  // A host scratch region comfortably larger than the test brain's demand,
  // holding the program image and the scheduler's fiber pools.
  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The button sensor backs its per-callsite derivation state on a managed
  // heap; the env hands the body the button port, heap, and roots.
  mindcraft::ManagedHeap heap(arena);
  mindcraft::MicroBitV2ButtonSensorEnv buttonEnv{&microbit.buttons, &heap, nullptr};
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports, nullptr, &buttonEnv);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  buttonEnv.roots = &scheduler;
  BrainRuntime brain(image, scheduler, surface);

  // Drive the cpp/codal host loop: it sources time through the clock port and
  // calls think() once per tick.
  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < 10; i++) {
    const ScheduleStep& step = kPressCyclesSchedule[i];
    if (step.buttonA >= 0) {
      microbit.buttons.pressed[0] = step.buttonA == 1;
    }
    const float timeMs = lastThinkTimeMs + step.advanceMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    // Mirrors the TS harness's dt stamping: dt stays 0 until a prior think exists.
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The end state mirrors the TS spec's device assertion: pixel (0,0) lit.
  CHECK(microbit.display.pixels[0][0] == 255);
}

TEST_CASE("the button-pressed fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[4] = {
      {16, -1, -1, -1}, {16, 1, -1, -1}, {16, -1, -1, -1}, {16, 0, -1, -1}};
  runButtonSensorParity("button-pressed", schedule, 4);
}

TEST_CASE("the button-released fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[3] = {{16, -1, -1, -1}, {16, 1, -1, -1}, {16, 0, -1, -1}};
  runButtonSensorParity("button-released", schedule, 3);
}

TEST_CASE("the button-long-click fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[4] = {
      {16, -1, -1, -1}, {16, 1, -1, -1}, {1016, -1, -1, -1}, {16, 0, -1, -1}};
  runButtonSensorParity("button-long-click", schedule, 4);
}

TEST_CASE("the button-double-click fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[4] = {
      {16, -1, -1, -1}, {16, 1, -1, -1}, {16, 0, -1, -1}, {16, 1, -1, -1}};
  runButtonSensorParity("button-double-click", schedule, 4);
}

TEST_CASE("the button-held fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[4] = {
      {16, -1, -1, -1}, {16, 1, -1, -1}, {16, -1, -1, -1}, {16, 0, -1, -1}};
  runButtonSensorParity("button-held", schedule, 4);
}

TEST_CASE("the button-b fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[3] = {{16, -1, -1, -1}, {16, -1, 1, -1}, {16, -1, 0, -1}};
  runButtonSensorParity("button-b", schedule, 3);
}

TEST_CASE("the button-ab fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[3] = {{16, -1, -1, -1}, {16, 1, -1, -1}, {16, -1, 1, -1}};
  runButtonSensorParity("button-ab", schedule, 3);
}

TEST_CASE("the button-logo fixture byte-matches the golden observable trace") {
  const ButtonScheduleStep schedule[3] = {{16, -1, -1, -1}, {16, -1, -1, 1}, {16, -1, -1, 0}};
  runButtonSensorParity("button-logo", schedule, 3);
}

TEST_CASE("the gesture-shake fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::Shake},
                                           {16, AccelerometerGesture::TiltUp}};
  runGestureSensorParity("gesture-shake", schedule, 3);
}

TEST_CASE("the gesture-tilt-up fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::TiltUp},
                                           {16, AccelerometerGesture::Shake}};
  runGestureSensorParity("gesture-tilt-up", schedule, 3);
}

TEST_CASE("the gesture-tilt-down fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::TiltDown},
                                           {16, AccelerometerGesture::TiltUp}};
  runGestureSensorParity("gesture-tilt-down", schedule, 3);
}

TEST_CASE("the gesture-tilt-left fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::TiltLeft},
                                           {16, AccelerometerGesture::TiltRight}};
  runGestureSensorParity("gesture-tilt-left", schedule, 3);
}

TEST_CASE("the gesture-tilt-right fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::TiltRight},
                                           {16, AccelerometerGesture::TiltLeft}};
  runGestureSensorParity("gesture-tilt-right", schedule, 3);
}

TEST_CASE("the gesture-face-up fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::FaceUp},
                                           {16, AccelerometerGesture::FaceDown}};
  runGestureSensorParity("gesture-face-up", schedule, 3);
}

TEST_CASE("the gesture-face-down fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::FaceDown},
                                           {16, AccelerometerGesture::FaceUp}};
  runGestureSensorParity("gesture-face-down", schedule, 3);
}

TEST_CASE("the gesture-freefall fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::Freefall},
                                           {16, AccelerometerGesture::Shake}};
  runGestureSensorParity("gesture-freefall", schedule, 3);
}

TEST_CASE("the gesture-default fixture byte-matches the golden observable trace") {
  using mindcraft::AccelerometerGesture;
  const GestureScheduleStep schedule[3] = {{16, AccelerometerGesture::None},
                                           {16, AccelerometerGesture::Shake},
                                           {16, AccelerometerGesture::TiltUp}};
  runGestureSensorParity("gesture-default", schedule, 3);
}

TEST_CASE("the exceptions-yield fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/exceptions-yield";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // TRY/THROW/YIELD and the cross-frame CALL touch no managed heap, so the
  // scheduler runs without one - exercising the no-heap grow-on-demand path.
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The rule yields across a round boundary, so the per-tick output differs;
  // three 16ms ticks mirror the TS oracle schedule.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the container-ops fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/container-ops";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // The container opcodes draw from a managed heap; the scheduler is its root
  // source and wires itself into the surface it runs the dispatch loop against.
  mindcraft::ManagedHeap heap(arena);
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The brain ignores input and runs identically each tick; advance 16ms thrice
  // to mirror the TS oracle schedule.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  CHECK(microbit.display.pixels[0][0] == 255);
}

TEST_CASE("the buffer-ops fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/buffer-ops";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The buffer builtins draw managed buffers from the heap; the hex/string
  // constructors read their borrowed string operands through the program, and
  // the trace writer resolves each managed buffer's bytes through the heap.
  mindcraft::ManagedHeap heap(arena, &image);
  writer.setHeap(&heap);
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The brain ignores input and runs identically each tick; advance 16ms thrice
  // to mirror the TS oracle schedule.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the dynamic-field-access fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/dynamic-field-access";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // The dynamic computed-key opcodes resolve field names through the type
  // registry over the decoded image; the struct slots draw from a managed heap.
  mindcraft::ManagedHeap heap(arena);
  const mindcraft::TypeRegistry types(image);
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the sync-action-yield fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/sync-action-yield";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // ACTION_CALL and the YIELD-in-sync-action fault touch no managed heap.
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The rule yields legally across a round boundary, then a sync action yields
  // and faults; three 16ms ticks mirror the TS oracle schedule. A per-fiber
  // fault does not latch host-loop fault mode.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the action-page-lifecycle fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/action-page-lifecycle";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // The bytecode actions and lifecycle hooks touch no managed heap.
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  // Startup runs page 0's initializer and activation hooks before tick 1.
  REQUIRE(hostLoop.startup().isOk());

  // Page index requested before each tick; -1 leaves the current page in place.
  // Switching to page 1 then back to page 0 mirrors the TS oracle schedule.
  const int requestedPage[4] = {-1, -1, 1, 0};
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    if (requestedPage[i] >= 0) {
      brain.requestPageChange(static_cast<uint32_t>(requestedPage[i]));
    }
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the context-variables fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/context-variables";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // Rule variables are per-rule managed maps; the heap is configured with the
  // image so the borrowed-string variable-name keys compare by content.
  mindcraft::ManagedHeap heap(arena, &image);
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The brain ignores input and runs identically each tick; advance 16ms thrice
  // to mirror the TS oracle schedule.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the rule-helper-variables fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/rule-helper-variables";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // The root rule calls a plain helper that reads and writes rule variables
  // through the calling rule's store; the per-rule maps and their borrowed
  // variable-name keys resolve through the heap configured with the image.
  mindcraft::ManagedHeap heap(arena, &image);
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The brain ignores input and runs identically each tick; advance 16ms thrice
  // to mirror the TS oracle schedule.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the struct-closure fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/struct-closure";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  ExecutionContext ctx;
  // Structs, closures, and the struct deep-copy sites draw from a managed heap;
  // the scheduler is its root source and wires itself into the surface.
  mindcraft::ManagedHeap heap(arena);
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The brain ignores input and runs identically each tick; advance 16ms thrice
  // to mirror the TS oracle schedule.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the user-tile button-display fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-button-display";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  // The injected context reaches the device through native struct field getters
  // (ctx.microbit, microbit.display/buttonA) and the button read / pixel write
  // dispatch through the target host-function table; both reach the same device
  // ports the host-action path uses, so the pixel write emits the same port line.
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports);
  ExecutionContext ctx;
  // STRUCT_GET_FIELD requires a heap even though native struct values carry no
  // managed slab; the brain allocates nothing on it.
  mindcraft::ManagedHeap heap(arena);
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Mirrors HELD_PIXEL_SCHEDULE in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-observable-trace.spec.ts.
  // The level-triggered rule lights the pixel on the two held ticks. -1 leaves
  // the button level unchanged before the think.
  constexpr int kButtonSchedule[4] = {-1, 1, -1, 0};
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    if (kButtonSchedule[i] >= 0) {
      microbit.buttons.pressed[0] = kButtonSchedule[i] == 1;
    }
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The device ends with pixel (0,0) lit, mirroring the TS oracle assertion.
  CHECK(microbit.display.pixels[0][0] == 255);
}

TEST_CASE("the user-tile button-states fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-button-states";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The actuator reads buttonA/buttonB/logo through native struct field getters
  // and writes each level to a pixel; the three reads dispatch through the target
  // host-function table (Button.isPressed and TouchButton.isPressed share one
  // body, keyed by the receiver discriminator).
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports);
  ExecutionContext ctx;
  mindcraft::ManagedHeap heap(arena);
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Mirrors SCHEDULE in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-button-states.spec.ts:
  // released, A only, A+B, then logo only. Index 0 is A, 1 is B, 2 is the logo;
  // -1 leaves a level unchanged before the think.
  const ButtonScheduleStep schedule[4] = {
      {16, -1, -1, -1}, {16, 1, -1, -1}, {16, -1, 1, -1}, {16, 0, 0, 1}};
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const ButtonScheduleStep& step = schedule[i];
    if (step.a >= 0) {
      microbit.buttons.pressed[0] = step.a == 1;
    }
    if (step.b >= 0) {
      microbit.buttons.pressed[1] = step.b == 1;
    }
    if (step.logo >= 0) {
      microbit.buttons.pressed[2] = step.logo == 1;
    }
    const float timeMs = lastThinkTimeMs + step.advanceMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The final think touches only the logo, so pixel (2,0) ends lit and (0,0) dark.
  CHECK(microbit.display.pixels[0][2] == 1);
  CHECK(microbit.display.pixels[0][0] == 0);
}

namespace {

/** One scheduled think for the accelerometer user-tile fixture: the inputs set
 * before the time advance, each guarded by a present flag so an unset input
 * holds its last value. Mirrors the ScheduleStep of wodal
 * packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-accelerometer-reads.spec.ts. */
struct AccelerometerScheduleStep {
  float advanceMs;
  bool setSample;
  int x;
  int y;
  int z;
  bool setGesture;
  int gesture;
  bool setPitchRadians;
  float pitchRadians;
  bool setRollRadians;
  float rollRadians;
};

} // namespace

TEST_CASE("the user-tile accelerometer-reads fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-accelerometer-reads";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The actuator reads ctx.microbit.accelerometer.* through the native struct
  // field getter and the eight accelerometer host-function bodies, then writes
  // each value to a pixel; the reads reach the same accelerometer port the A1
  // read-back vectors exercise.
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports);
  ExecutionContext ctx;
  mindcraft::ManagedHeap heap(arena);
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Mirrors SCHEDULE in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-accelerometer-reads.spec.ts:
  // tick 3 sets nothing (all reads hold), ticks 2 and 4 set only some inputs.
  const AccelerometerScheduleStep schedule[4] = {
      {16, true, 10, 20, 30, true, 11, true, 1.0f, true, 2.0f},
      {16, true, 40, 20, 30, true, 3, true, 3.0f, false, 0.0f},
      {16, false, 0, 0, 0, false, 0, false, 0.0f, false, 0.0f},
      {16, true, 40, 20, 50, true, 0, false, 0.0f, true, 0.0f},
  };
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const AccelerometerScheduleStep& step = schedule[i];
    if (step.setSample) {
      microbit.accelerometer.x = step.x;
      microbit.accelerometer.y = step.y;
      microbit.accelerometer.z = step.z;
    }
    if (step.setGesture) {
      microbit.accelerometer.gesture = step.gesture;
    }
    if (step.setPitchRadians) {
      microbit.accelerometer.pitchRadians = step.pitchRadians;
    }
    if (step.setRollRadians) {
      microbit.accelerometer.rollRadians = step.rollRadians;
    }
    const float timeMs = lastThinkTimeMs + step.advanceMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The final think holds x=40 at pixel (0,0) and derives pitch 171 from 3
  // radians at pixel (3,0); the gesture cleared to 0 at pixel (2,1).
  CHECK(microbit.display.pixels[0][0] == 40);
  CHECK(microbit.display.pixels[0][3] == 171);
  CHECK(microbit.display.pixels[1][2] == 0);
}

TEST_CASE("the user-tile i2c-write fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-i2c-write";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.i2c.writer = &writer;
  TraceTap tap(writer);

  // The actuator reads ctx.microbit.i2c through the native struct field getter
  // and writes a Buffer.fromHex constant (a managed buffer) through the
  // writeBuffer host function; the env resolves that buffer through the heap.
  mindcraft::ManagedHeap heap(arena, &image);
  mindcraft::MicroBitV2I2CWriteEnv i2cEnv{&microbit.i2c, &heap, &image};
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports, nullptr, &i2cEnv);
  ExecutionContext ctx;
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Two 16ms thinks mirror SCHEDULE in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-i2c-write.spec.ts.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 2; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The injectable bus records the exact address and bytes the brain wrote.
  REQUIRE(microbit.i2c.writes.size() == 2);
  for (const auto& write : microbit.i2c.writes) {
    CHECK(write.address == 0x10);
    CHECK(write.bytes == std::vector<uint8_t>{1, 2, 3, 4, 5});
  }
}

TEST_CASE("the user-tile i2c-read fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-i2c-read";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.i2c.writer = &writer;
  // The responder address returns three bytes; the absent address is a no-device
  // read. Mirrors the injected responses in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-i2c-read.spec.ts.
  microbit.i2c.readResponses[0x42] = {0xaa, 0xbb, 0xcc};
  TraceTap tap(writer);

  // The actuator reads ctx.microbit.i2c through the native struct field getter
  // and echoes each read (a managed Buffer the readBuffer host function
  // allocates) straight back through writeBuffer; the read body allocates its
  // buffer through the heap with the scheduler as its collection roots.
  mindcraft::ManagedHeap heap(arena, &image);
  mindcraft::MicroBitV2I2CWriteEnv i2cWriteEnv{&microbit.i2c, &heap, &image};
  mindcraft::MicroBitV2I2CReadEnv i2cReadEnv{&microbit.i2c, &heap, nullptr};
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto hostFuncs =
      mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports, nullptr, &i2cWriteEnv, &i2cReadEnv);
  ExecutionContext ctx;
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  i2cReadEnv.roots = &scheduler;
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Two 16ms thinks mirror SCHEDULE in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-i2c-read.spec.ts.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 2; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // Each echoed write carries the bytes the read returned: the responder bytes
  // for the responder address, an empty buffer for the no-device read.
  REQUIRE(microbit.i2c.writes.size() == 4);
  for (size_t i = 0; i < microbit.i2c.writes.size(); i += 2) {
    CHECK(microbit.i2c.writes[i].address == 0x10);
    CHECK(microbit.i2c.writes[i].bytes == std::vector<uint8_t>{0xaa, 0xbb, 0xcc});
    CHECK(microbit.i2c.writes[i + 1].address == 0x11);
    CHECK(microbit.i2c.writes[i + 1].bytes.empty());
  }
}

TEST_CASE("the user-tile gpio fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-gpio";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.gpio.writer = &writer;
  // Inject the line-sensor level the actuator reads. Mirrors the injected level
  // in wodal packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-gpio.spec.ts.
  microbit.gpio.levels[13] = 1;
  TraceTap tap(writer);

  // The actuator reads ctx.microbit.gpio through the native struct field getter
  // and drives the four pin ops; the gpio bodies bind over the port in ports.
  mindcraft::ManagedHeap heap(arena, &image);
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports);
  ExecutionContext ctx;
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Two 16ms thinks mirror SCHEDULE in wodal
  // packages/wodal/src/targets/microbit-v2/mindcraft/user-tile-gpio.spec.ts.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 2; i++) {
    const float timeMs = lastThinkTimeMs + 16;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The injectable model records the in-range writes/pull/servo and served the
  // injected read; the out-of-range pin recorded nothing.
  REQUIRE(microbit.gpio.writes.size() == 2);
  for (const auto& write : microbit.gpio.writes) {
    CHECK(write.pin == 2);
    CHECK(write.value == 1);
  }
  REQUIRE(microbit.gpio.pulls.size() == 2);
  for (const auto& pull : microbit.gpio.pulls) {
    CHECK(pull.pin == 13);
    CHECK(pull.mode == 0);
  }
  REQUIRE(microbit.gpio.servos.size() == 2);
  for (const auto& servo : microbit.gpio.servos) {
    CHECK(servo.pin == 1);
    CHECK(servo.angle == 90);
  }
}

TEST_CASE("the user-tile pixel-conversion fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/user-tile-pixel-conversion";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The actuator writes fractional / negative / over-range / out-of-matrix values
  // through the display setPixel host-function, which narrows each to the port's
  // int16 coordinate / uint8 brightness before the write crosses the port.
  auto bindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports);
  ExecutionContext ctx;
  mindcraft::ManagedHeap heap(arena);
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap, &heap};
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // The brain ignores input and writes the same constants each tick; one 16ms
  // think mirrors the TS oracle schedule.
  microbit.clock.now = 16;
  writer.tick(1, 16, 0);
  hostLoop.tick();
  REQUIRE_FALSE(hostLoop.faulted());

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The stored pixels reflect the narrowing: 7.9 -> 7, 300 -> 44, -30 -> 226, and
  // the fractional coordinate 1.9 -> column 1.
  CHECK(microbit.display.pixels[0][1] == 7);
  CHECK(microbit.display.pixels[0][2] == 44);
  CHECK(microbit.display.pixels[0][3] == 226);
  CHECK(microbit.display.pixels[1][1] == 5);
}

namespace {

/**
 * The firmware action table: the core sensor/actuator surface (ids 0-7)
 * followed by the microbit-v2 host actions. Mirrors the table assembled in
 * targets/microbit-v2/source/main.cpp.
 */
std::array<mindcraft::HostActionBinding,
           mindcraft::kCoreHostActionBindingCount + mindcraft::kMicroBitV2HostActionBindingCount>
combineActionTable(
    const std::array<mindcraft::HostActionBinding, mindcraft::kCoreHostActionBindingCount>& core,
    const std::array<mindcraft::HostActionBinding, mindcraft::kMicroBitV2HostActionBindingCount>&
        microbit) {
  std::array<mindcraft::HostActionBinding,
             mindcraft::kCoreHostActionBindingCount + mindcraft::kMicroBitV2HostActionBindingCount>
      table{};
  for (size_t i = 0; i < core.size(); i++) {
    table[i] = core[i];
  }
  for (size_t i = 0; i < microbit.size(); i++) {
    table[core.size() + i] = microbit[i];
  }
  return table;
}

// Loads the draw-image fixture `name`, runs `tickCount` thinks at `tickMs` each
// (settling the display lease before each think, as the device's pollDisplay
// does), and byte-compares the rendered trace against the committed golden. The
// draw env reaches the display, heap, and program; the writer's heap renders the
// Image struct argument's slots in the async dispatch line.
void checkDrawFixture(const std::string& name, int tickCount, float tickMs) {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/" + name;
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  writer.setHeap(&heap);
  mindcraft::MicroBitV2DrawImageEnv drawEnv{&microbit.display, &heap, &image};
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings =
      mindcraft::makeMicroBitV2HostActionBindings(microbit.ports, nullptr, nullptr, &drawEnv);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < tickCount; i++) {
    const float timeMs = lastThinkTimeMs + tickMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    microbit.display.advanceScroll(timeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

// Loads a user-tile draw fixture `name` whose async actuator builds an Image
// inline and awaits ctx.microbit.display.drawImage (the op-41 async host
// function). Wires the native-struct receiver resolution and the host-function
// table (with the draw env) alongside the core host actions (the on-page-entered
// sensor), runs `tickCount` thinks at `tickMs` each (settling the display lease
// before each think, as the device's pollDisplay does), and byte-compares the
// rendered trace against the committed golden.
void checkUserTileDrawFixture(const std::string& name, int tickCount, float tickMs) {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/" + name;
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  writer.setHeap(&heap);
  mindcraft::MicroBitV2DrawImageEnv drawEnv{&microbit.display, &heap, &image};
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  auto hostFuncs = mindcraft::makeMicroBitV2HostFuncBindings(microbit.ports, &drawEnv);
  mindcraft::TypeRegistry types(image);
  auto nativeStructs = mindcraft::makeMicroBitV2NativeStructBindings(types);
  types.setNativeStructBindings({nativeStructs.data(), nativeStructs.size()});
  auto registeredStructs = mindcraft::makeSharedRegisteredStructSlotCounts();
  types.setRegisteredStructSlotCounts({registeredStructs.data(), registeredStructs.size()});
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;
  surface.types = &types;
  surface.hostFunctions = {hostFuncs.data(), hostFuncs.size()};

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < tickCount; i++) {
    const float timeMs = lastThinkTimeMs + tickMs;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    microbit.display.advanceScroll(timeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

} // namespace

TEST_CASE("the timer-brain fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/timer-brain";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The core sensor/actuator surface reaches the brain, RNG, and heap; the
  // timeout sensor's per-callsite state list draws from the managed heap.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Four 600ms thinks mirror the TS oracle schedule: the timeout fires on tick
  // 3 and switches to page 2, which lights pixel (0,0) on tick 4.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const float timeMs = lastThinkTimeMs + 600;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  CHECK(microbit.display.pixels[0][0] == 255);
}

TEST_CASE("the restart-interrupt fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/restart-interrupt";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Three 600ms thinks mirror the TS oracle schedule: tick 1 switches to the
  // current page (a restart), which cancels the rule before its pixel write, so
  // the write is abandoned and the pixel never lights.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 600;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  CHECK(microbit.display.pixels[0][0] == 0);
}

TEST_CASE("the core-host-actions fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/core-host-actions";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The switch-page-by-id actuator resolves the borrowed page-id string through
  // the heap configured with the image.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Three 600ms thinks mirror the TS oracle schedule: page 0 reads page state,
  // yields, and switches by page id on tick 1; page 1 reads page state and
  // restarts itself on ticks 2 and 3.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 3; i++) {
    const float timeMs = lastThinkTimeMs + 600;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
}

TEST_CASE("the display-scroll fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/display-scroll";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The rule's on-page-entered trigger is a core action; the async scroll and
  // set-pixel are microbit actions. The scroll body reads its borrowed text
  // string through the image-backed heap; the scroll env hands the body that
  // heap and the display port.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  mindcraft::MicroBitV2DisplayScrollEnv scrollEnv{&microbit.display, &heap};
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports, &scrollEnv);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Four 1100ms thinks mirror the wodal display-scroll oracle schedule: the
  // scroll dispatches async on tick 1, its handle resolves once the pinned
  // completion time passes, and the rule resumes and lights pixel (0,0) on tick
  // 4. The scroll completion settles the handle out of band before each think,
  // as the CODAL animation-complete event does on device; the think then drains
  // it and resumes the waiter on the next round.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const float timeMs = lastThinkTimeMs + 1100;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    microbit.display.advanceScroll(timeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  CHECK(microbit.display.pixels[0][0] == 255);
}

TEST_CASE("the draw-image-forget fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-forget", 3, 100.0f);
}

TEST_CASE("the draw-image-timed fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-timed", 5, 100.0f);
}

TEST_CASE("the draw-image-dropped fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-dropped", 5, 100.0f);
}

TEST_CASE("the draw-image-defaults fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-defaults", 4, 600.0f);
}

TEST_CASE("the draw-image-preempt fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-preempt", 3, 100.0f);
}

TEST_CASE("the draw-image-builtins fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-builtins", 2, 100.0f);
}

TEST_CASE("the draw-image-sequence fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-sequence", 8, 100.0f);
}

TEST_CASE("the draw-image-sequence-dropped fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-sequence-dropped", 5, 100.0f);
}

TEST_CASE("the draw-image-sequence-preempt fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-sequence-preempt", 3, 100.0f);
}

TEST_CASE("the draw-image-sequence-compiled fixture byte-matches the golden observable trace") {
  checkDrawFixture("draw-image-sequence-compiled", 5, 100.0f);
}

TEST_CASE("the user-tile-draw-timed fixture byte-matches the golden observable trace") {
  checkUserTileDrawFixture("user-tile-draw-timed", 5, 100.0f);
}

TEST_CASE("the user-tile-draw-forget fixture byte-matches the golden observable trace") {
  checkUserTileDrawFixture("user-tile-draw-forget", 2, 100.0f);
}

TEST_CASE("the user-tile-draw-icon fixture byte-matches the golden observable trace") {
  checkUserTileDrawFixture("user-tile-draw-icon", 2, 100.0f);
}

TEST_CASE("the display-scroll-drop fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/display-scroll-drop";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  mindcraft::MicroBitV2DisplayScrollEnv scrollEnv{&microbit.display, &heap};
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports, &scrollEnv);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Four 1100ms thinks: the holder scrolls "hi" and takes the lease on tick 1,
  // the competitor's "yo" is dropped (no port line) and resumes in the same
  // think, and the holder resumes and lights pixel (0,0) on tick 4.
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const float timeMs = lastThinkTimeMs + 1100;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    microbit.display.advanceScroll(timeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  CHECK(microbit.display.pixels[0][0] == 255);
}

TEST_CASE("the async-action fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/async-action";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The rule awaits a bytecode action (ACTION_CALL_ASYNC) and then reads the
  // current page id, a device-free core action; no microbit ports are written.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  // Four 600ms thinks: tick 1 dispatches the async action and parks, tick 2 runs
  // the child action body, tick 3 resumes the rule (which reads the page id).
  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const float timeMs = lastThinkTimeMs + 600;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // Device-free: no pixel is ever written.
  CHECK(microbit.display.pixels[0][0] == 0);
}

TEST_CASE("the pixel-conversion fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/pixel-conversion";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The rule writes pixels with valid, fractional, and out-of-range coordinates
  // and over-bright/fractional brightness; the pinned f32->u8 conversion at the
  // port must discard the same writes and clamp the same values as the wodal
  // oracle.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  microbit.clock.now = 600;
  writer.tick(1, 600, 0);
  hostLoop.tick();
  REQUIRE_FALSE(hostLoop.faulted());

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The fractional x truncated to 1 so pixel (1, 2) is lit; the out-of-matrix
  // coordinate stored nothing; the wrapped and truncated brightnesses landed.
  CHECK(microbit.display.pixels[2][1] == 255);
  CHECK(microbit.display.pixels[0][0] == 44);
  CHECK(microbit.display.pixels[1][1] == 100);
}

TEST_CASE("the opcode-coverage fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/opcode-coverage";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The rule exercises the list-mutation and stack opcodes no other golden
  // reaches, then writes a pixel reading back the final list state. The managed
  // list lives on the heap.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  microbit.clock.now = 600;
  writer.tick(1, 600, 0);
  hostLoop.tick();
  REQUIRE_FALSE(hostLoop.faulted());

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  // The list mutations leave list = [1], lighting pixel (1, 1).
  CHECK(microbit.display.pixels[1][1] == 255);
}

TEST_CASE("the managed-string-scroll fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/managed-string-scroll";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount, kSharedTypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  HostMicroBit microbit;
  microbit.display.writer = &writer;
  TraceTap tap(writer);

  // The scrolled text is a managed string built by the string-concat host
  // function; the scroll body reads its bytes from the heap, the same path the
  // borrowed-string scroll exercises.
  mindcraft::CoreHostActionEnv coreEnv;
  mindcraft::VmRng rng;
  mindcraft::ManagedHeap heap(arena, &image);
  // The async scroll arg is a managed string; the trace writer resolves its
  // bytes through the heap.
  writer.setHeap(&heap);
  mindcraft::MicroBitV2DisplayScrollEnv scrollEnv{&microbit.display, &heap};
  auto coreBindings = mindcraft::makeCoreHostActionBindings(coreEnv);
  auto mbBindings = mindcraft::makeMicroBitV2HostActionBindings(microbit.ports, &scrollEnv);
  auto actions = combineActionTable(coreBindings, mbBindings);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {actions.data(), actions.size()}, &tap, &heap};
  surface.rng = &rng;

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  coreEnv.brain = &brain;
  coreEnv.rng = &rng;
  coreEnv.heap = &heap;
  coreEnv.roots = &scheduler;

  HostLoop hostLoop(brain, microbit.ports);
  REQUIRE(hostLoop.startup().isOk());

  float lastThinkTimeMs = 0;
  for (int i = 0; i < 4; i++) {
    const float timeMs = lastThinkTimeMs + 1100;
    microbit.clock.now = static_cast<uint32_t>(timeMs);
    writer.tick(static_cast<uint32_t>(i + 1), timeMs,
                lastThinkTimeMs == 0 ? 0 : timeMs - lastThinkTimeMs);
    microbit.display.advanceScroll(timeMs);
    hostLoop.tick();
    REQUIRE_FALSE(hostLoop.faulted());
    lastThinkTimeMs = timeMs;
  }

  CHECK(tap.renderable);
  CHECK(sink.text() == golden);
  CHECK(microbit.display.pixels[0][0] == 255);
}
