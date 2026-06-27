#include "doctest/doctest.h"

#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "hostkit/observable-trace.h"
#include "string-sink.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

using mindcraft::BrainRuntime;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FiberScheduler;
using mindcraft::Frame;
using mindcraft::ObservableTraceWriter;
using mindcraft::Op;
using mindcraft::ProgramImage;
using mindcraft::RegionArena;
using mindcraft::RuntimeSurface;
using mindcraft::Span;
using mindcraft::Value;
using mindcraft::VmObserver;

namespace {

/** Forwards scheduler faults to the trace writer. */
struct FaultTraceTap : VmObserver {
  explicit FaultTraceTap(ObservableTraceWriter& writer) : writer(writer) {}

  ObservableTraceWriter& writer;

  void onHostActionCall(uint32_t, uint32_t, Span<const Value>, const Value&) override {}

  void onFiberFault(uint32_t fiberId, ErrorCode code) override { writer.fiberFault(fiberId, code); }
};

} // namespace

TEST_CASE("the trace header renders the format version, profile, and precision") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  CHECK(sink.text() == "mctrace 1\nprofile 0\nprecision f32\n");
}

TEST_CASE("tick lines render 1-based ordinals and f32 bit-pattern stamps") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  writer.tick(1, 16.0f, 0.0f);
  writer.tick(10, 224.0f, 16.0f);
  const std::string expected = "mctrace 1\nprofile 0\nprecision f32\n"
                               "tick 1 time 41800000 dt 00000000\n"
                               "tick a time 43600000 dt 41800000\n";
  CHECK(sink.text() == expected);
}

TEST_CASE("action lines render every defined value token") {
  ProgramBuilder b;
  b.poolString("a\"b\\c\x01");
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  const Value args[5] = {mindcraft::kVoidValue, mindcraft::kNilValue, Value::boolean(true),
                         Value::number(-7.25f), Value::borrowedString(0)};
  REQUIRE(writer.hostActionCall(0x400, 3, Span<const Value>(args, 5), Value::boolean(false)));
  const std::string expected =
      "mctrace 1\nprofile 0\nprecision f32\n"
      "action 400 site 3 args 5 void nil bool 1 number c0e80000 string \"a\\\"b\\\\c\\x01\""
      " result bool 0\n";
  CHECK(sink.text() == expected);
}

TEST_CASE("a value kind outside the trace vocabulary is unrenderable") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  CHECK(!writer.hostActionCall(1, 0, {}, Value::enumSymbol(0, 2)));
}

TEST_CASE("port and fault lines render their fixed shapes") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  writer.displaySetPixel(0.0f, 2.0f, 255.0f);
  const uint8_t i2cBytes[5] = {1, 2, 3, 4, 5};
  writer.i2cWrite(0x10, i2cBytes, 5);
  const uint8_t i2cRead[3] = {0xaa, 0xbb, 0xcc};
  writer.i2cRead(0x42, 3, i2cRead, 3);
  writer.i2cRead(0x55, 2, i2cRead, 0);
  writer.gpioDigitalRead(0xd, 1);
  writer.gpioDigitalWrite(0x2, 1);
  writer.gpioSetPull(0xd, 0);
  writer.gpioServoWrite(0x1, 0x5a);
  writer.fiberFault(3, ErrorCode::StackUnderflow);
  const std::string expected = "mctrace 1\nprofile 0\nprecision f32\n"
                               "port display set-pixel 00000000 40000000 437f0000\n"
                               "port i2c write 10 0102030405\n"
                               "port i2c read 42 3 aabbcc\n"
                               "port i2c read 55 2 \n"
                               "port gpio digital-read d 1\n"
                               "port gpio digital-write 2 1\n"
                               "port gpio set-pull d 0\n"
                               "port gpio servo-write 1 5a\n"
                               "fault 3 6\n";
  CHECK(sink.text() == expected);
}

TEST_CASE("a faulting rule traces the fault line shape and respawns next think") {
  // A synthetic program whose only rule faults immediately: each think emits
  // one fault line carrying a fresh fiber id and the numeric ErrorCode.
  ProgramBuilder b;
  b.poolString("page-id");
  b.beginFunction().instr(Op::POP).instr(Op::RET);
  b.ruleFunc(0);
  b.beginPage(0).pageRoot(0);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  StringTextSink sink;
  ObservableTraceWriter writer(sink, image);
  FaultTraceTap tap(writer);
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, &tap};
  std::array<uint8_t, 4 * (2048 + sizeof(mindcraft::FiberRecord) + 64) + 256> arenaBytes;
  RegionArena arena(Span<uint8_t>(arenaBytes.data(), arenaBytes.size()));
  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  writer.tick(1, 16.0f, 0.0f);
  REQUIRE(brain.think(16.0f).isOk());
  writer.tick(2, 32.0f, 16.0f);
  REQUIRE(brain.think(32.0f).isOk());

  const std::string expected = "mctrace 1\nprofile 0\nprecision f32\n"
                               "tick 1 time 41800000 dt 00000000\n"
                               "fault 1 6\n"
                               "tick 2 time 42000000 dt 41800000\n"
                               "fault 2 6\n";
  CHECK(sink.text() == expected);
}
