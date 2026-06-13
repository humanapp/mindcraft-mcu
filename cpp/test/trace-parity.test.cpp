#include "doctest/doctest.h"

#include "codal/device-port.h"
#include "codal/device-sizing.h"
#include "codal/host-loop.h"
#include "core/codec/observable-trace.h"
#include "core/codec/program-reader.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/load-error.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "fixture-paths.h"
#include "string-sink.h"
#include "targets/microbit-v2/abi/host-action-bindings.h"
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
using mindcraft::FiberScheduler;
using mindcraft::HostLoop;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::kRecommendedVmArenaBytes;
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

/**
 * Host MicroBit stub over the device ports: a 5x5 pixel grid, settable
 * button levels, and a display tap that records each pixel write into the
 * observable trace before it lands.
 */
struct HostMicroBit {
  struct TracingDisplay : mindcraft::PixelDisplayPort {
    ObservableTraceWriter* writer = nullptr;
    uint8_t pixels[5][5] = {};

    void setPixel(uint8_t x, uint8_t y, uint8_t brightness) override {
      if (writer != nullptr) {
        writer->displaySetPixel(static_cast<float>(x), static_cast<float>(y),
                                static_cast<float>(brightness));
      }
      if (x < 5 && y < 5) {
        pixels[y][x] = brightness;
      }
    }
  };

  struct SettableButtons : mindcraft::ButtonInputPort {
    bool pressed[2] = {false, false};

    bool isPressed(uint8_t buttonIndex) override { return pressed[buttonIndex]; }
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
  NullFaultDisplay faultDisplay;
  FixedClock clock;

  mindcraft::DevicePorts ports{&display, &buttons, &faultDisplay, &clock};
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
    {32, 1},  // released-to-pressed edge fires the rule
    {16, -1}, // held: edge detection does not re-trigger
    {16, -1}, // still held
    {48, 0},  // release: not reported by the default modifier
    {16, -1}, // steady released
    {32, 1},  // second press edge fires the rule again
    {16, 0},  // release again
    {16, -1}, // steady released
};

} // namespace

TEST_CASE("the button-display fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/button-display";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".press-cycles.trace");

  // One region at the device-recommended size holds the program image and the
  // scheduler's fiber pools.
  std::vector<uint8_t> arenaStorage(kRecommendedVmArenaBytes);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount};
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
  RuntimeSurface surface{&ctx, {bindings.data(), bindings.size()}, &tap};

  FiberScheduler scheduler(image, surface, arena);
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
