#include "doctest/doctest.h"

#include "codal/device-port.h"
#include "codal/host-loop.h"
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
#include "targets/microbit-v2/abi/host-action-bindings.h"
#include "targets/microbit-v2/abi/host-func-bindings.h"
#include "targets/microbit-v2/abi/native-struct-bindings.h"
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
    bool scrolling = false;
    float completionTime = 0;
    mindcraft::AsyncHandle activeScroll{};

    void setPixel(uint8_t x, uint8_t y, uint8_t brightness) override {
      if (writer != nullptr) {
        writer->displaySetPixel(static_cast<float>(x), static_cast<float>(y),
                                static_cast<float>(brightness));
      }
      if (x < 5 && y < 5) {
        pixels[y][x] = brightness;
      }
    }

    // Host stub: completion is driven by the pinned formula against logical time
    // (no glyph rendering), so the resume round matches the wodal oracle. A
    // scroll requested while one is in progress is rejected (settled at once).
    void scrollText(const uint8_t* bytes, uint32_t length, uint32_t delayMs, float requestTimeMs,
                    mindcraft::AsyncHandle handle) override {
      if (writer != nullptr) {
        writer->displayScroll(bytes, length);
      }
      if (scrolling) {
        handle.resolve(mindcraft::kVoidValue);
        return;
      }
      scrolling = true;
      completionTime =
          requestTimeMs + static_cast<float>(mindcraft::scrollDurationMs(length, delayMs));
      activeScroll = handle;
    }

    // Resolve the active scroll once due, mirroring the device's pollScroll.
    void advanceScroll(float now) {
      if (!scrolling || now < completionTime) {
        return;
      }
      scrolling = false;
      activeScroll.resolve(mindcraft::kVoidValue);
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

  // A host scratch region comfortably larger than the test brain's demand,
  // holding the program image and the scheduler's fiber pools.
  std::vector<uint8_t> arenaStorage(64 * 1024);
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

  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
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

TEST_CASE("the exceptions-yield fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/exceptions-yield";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
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

TEST_CASE("the dynamic-field-access fixture byte-matches the golden observable trace") {
  const std::string base =
      std::string(mindcraft::test::kWodalFixturesDir) + "/dynamic-field-access";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
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

} // namespace

TEST_CASE("the timer-brain fixture byte-matches the golden observable trace") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/timer-brain";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
  const std::string golden = readTextFile(base + ".ticks.trace");

  std::vector<uint8_t> arenaStorage(64 * 1024);
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
