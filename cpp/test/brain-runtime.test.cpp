#include "doctest/doctest.h"

#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/host-action.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <vector>

using mindcraft::BrainRuntime;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FiberScheduler;
using mindcraft::Frame;
using mindcraft::HostActionBinding;
using mindcraft::kMaxFrameDepth;
using mindcraft::kMaxLocalsSize;
using mindcraft::kMaxStackSize;
using mindcraft::kNoCallSiteId;
using mindcraft::Op;
using mindcraft::ProgramImage;
using mindcraft::RegionArena;
using mindcraft::RuntimeSurface;
using mindcraft::Span;
using mindcraft::Status;
using mindcraft::Value;
using mindcraft::VmObserver;

namespace {

/** One shared region with room for several fibers' regions and records; tests spawn a few. */
struct SchedulerStorage {
  static constexpr size_t kArenaBytes = 8 * (2048 + sizeof(mindcraft::FiberRecord) + 64) + 256;
  std::array<uint8_t, kArenaBytes> bytes;
  RegionArena arena{Span<uint8_t>(bytes.data(), bytes.size())};
};

/** Observer counting dispatches and recording faulted fiber ids. */
struct CountingObserver : VmObserver {
  uint32_t actionCalls = 0;
  std::vector<uint32_t> faultedFibers;
  std::vector<ErrorCode> faultCodes;

  void onHostActionCall(uint32_t, uint32_t, Span<const Value>, const Value&) override {
    actionCalls++;
  }

  void onFiberFault(uint32_t fiberId, ErrorCode code) override {
    faultedFibers.push_back(fiberId);
    faultCodes.push_back(code);
  }
};

Value execNoop(void*, ExecutionContext&, Span<const Value>) { return mindcraft::kVoidValue; }

void markStateOnPageEntered(void*, ExecutionContext& ctx) {
  ctx.setCallSiteState(Value::boolean(true));
}

/** A one-page program whose single rule dispatches action 1 at call site 0. */
ProgramImage rulePageProgram(ProgramBuilder& b, std::vector<uint8_t>& storage) {
  b.poolString("page-id");
  b.beginFunction().instr(Op::HOST_ACTION_CALL, 1, 0, 0).instr(Op::RET);
  b.ruleFunc(0);
  b.beginPage(0).pageRoot(0).pageHostCallSite(0, 1);
  return b.build(storage);
}

} // namespace

TEST_CASE("think stamps time, the dt rule, and the tick counter") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = rulePageProgram(b, storage);

  const HostActionBinding bindings[1] = {{1, &execNoop, nullptr, nullptr}};
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {bindings, 1}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  // dt stays 0 until a previous think exists.
  REQUIRE(brain.think(16.0f).isOk());
  CHECK(ctx.time == 16.0f);
  CHECK(ctx.dt == 0.0f);
  CHECK(ctx.currentTick == 1);

  REQUIRE(brain.think(48.0f).isOk());
  CHECK(ctx.time == 48.0f);
  CHECK(ctx.dt == 32.0f);
  CHECK(ctx.currentTick == 2);
}

TEST_CASE("a completed rule fiber respawns and re-evaluates every think") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = rulePageProgram(b, storage);

  const HostActionBinding bindings[1] = {{1, &execNoop, nullptr, nullptr}};
  ExecutionContext ctx;
  CountingObserver observer;
  RuntimeSurface surface{&ctx, {bindings, 1}, &observer};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  for (int i = 1; i <= 3; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
    CHECK(observer.actionCalls == static_cast<uint32_t>(i));
  }
}

TEST_CASE("a fault kills the fiber, not the rule: it respawns next think") {
  ProgramBuilder b;
  b.poolString("page-id");
  b.beginFunction().instr(Op::POP).instr(Op::RET);
  b.ruleFunc(0);
  b.beginPage(0).pageRoot(0);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  CountingObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  REQUIRE(brain.think(16.0f).isOk());
  REQUIRE(brain.think(32.0f).isOk());
  REQUIRE(observer.faultedFibers.size() == 2);
  // Each think faulted a fresh fiber: respawn allocated a new fiber id.
  CHECK(observer.faultedFibers[0] == 1);
  CHECK(observer.faultedFibers[1] == 2);
  CHECK(observer.faultCodes[0] == ErrorCode::StackUnderflow);
  CHECK(observer.faultCodes[1] == ErrorCode::StackUnderflow);
}

TEST_CASE("an unregistered action id faults the fiber and the rule respawns") {
  ProgramBuilder b;
  b.poolString("page-id");
  b.beginFunction().instr(Op::HOST_ACTION_CALL, 0x777, 0, 0).instr(Op::RET);
  b.ruleFunc(0);
  b.beginPage(0).pageRoot(0).pageHostCallSite(0, 0x777);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  CountingObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  // Activation skips the unregistered call site; the existence check faults
  // at dispatch instead.
  REQUIRE(brain.startup().isOk());

  REQUIRE(brain.think(16.0f).isOk());
  REQUIRE(brain.think(32.0f).isOk());
  REQUIRE(observer.faultedFibers.size() == 2);
  CHECK(observer.faultedFibers[0] == 1);
  CHECK(observer.faultedFibers[1] == 2);
  CHECK(observer.faultCodes[0] == ErrorCode::ScriptError);
  CHECK(observer.faultCodes[1] == ErrorCode::ScriptError);
}

TEST_CASE("page activation runs each call site's page-entered hook bound to it") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = rulePageProgram(b, storage);

  // The hook records state against whatever call site activation binds; finding
  // it set on call site 0, with the binding restored afterward, proves the hook
  // ran bound to that site.
  const HostActionBinding bindings[1] = {{1, &execNoop, &markStateOnPageEntered, nullptr}};
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {bindings, 1}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  REQUIRE(ctx.callSiteStatePresent.size() >= 1);
  CHECK(ctx.callSiteStatePresent[0]);
  CHECK(ctx.callSiteStates[0].asBoolean());
  CHECK(ctx.currentCallSiteId == kNoCallSiteId);
}

namespace {

/** Host data of {@link execReenterThink}: the runtime to re-enter and the result. */
struct ReentryProbe {
  BrainRuntime* brain;
  Status reentry = Status::ok();
};

Value execReenterThink(void* hostData, ExecutionContext&, Span<const Value>) {
  ReentryProbe* probe = static_cast<ReentryProbe*>(hostData);
  probe->reentry = probe->brain->think(999.0f);
  return mindcraft::kVoidValue;
}

} // namespace

TEST_CASE("think is single-entry: re-entering from a host body fails loudly") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = rulePageProgram(b, storage);

  ReentryProbe probe{nullptr};
  const HostActionBinding bindings[1] = {{1, &execReenterThink, nullptr, &probe}};
  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {bindings, 1}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  probe.brain = &brain;
  REQUIRE(brain.startup().isOk());

  REQUIRE(brain.think(16.0f).isOk());
  REQUIRE(!probe.reentry.isOk());
  CHECK(probe.reentry.error() == ErrorCode::HostError);
  // The outer think survived: time advanced normally on the next think.
  REQUIRE(brain.think(32.0f).isOk());
  CHECK(ctx.dt == 16.0f);
}

TEST_CASE("a program with no pages starts up and thinks as a no-op") {
  ProgramBuilder b;
  b.valueNil();
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());
  REQUIRE(brain.think(16.0f).isOk());
  CHECK(ctx.currentTick == 0);
  CHECK(scheduler.liveCount() == 0);
}

TEST_CASE("requesting the active page restarts its rules from their entry") {
  ProgramBuilder b;
  b.poolString("page-id");
  // The rule dispatches the action, then yields and suspends mid-rule.
  b.beginFunction().instr(Op::HOST_ACTION_CALL, 1, 0, 0).instr(Op::YIELD).instr(Op::RET);
  b.ruleFunc(0);
  b.beginPage(0).pageRoot(0).pageHostCallSite(0, 1);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  const HostActionBinding bindings[1] = {{1, &execNoop, nullptr, nullptr}};
  ExecutionContext ctx;
  CountingObserver observer;
  RuntimeSurface surface{&ctx, {bindings, 1}, &observer};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  // Think 1 dispatches the action once, then the rule yields and suspends.
  REQUIRE(brain.think(16.0f).isOk());
  CHECK(observer.actionCalls == 1);

  // Requesting the active page restarts it: the suspended fiber is cancelled and
  // respawned from its entry, so think 2 re-dispatches the action. A plain
  // resume past the yield would leave the count at 1.
  brain.requestPageChange(0);
  REQUIRE(brain.think(32.0f).isOk());
  CHECK(observer.actionCalls == 2);
}
