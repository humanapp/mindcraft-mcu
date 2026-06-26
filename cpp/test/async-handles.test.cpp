#include "doctest/doctest.h"

#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/host-action.h"
#include "core/runtime/host-function.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <vector>

using mindcraft::AsyncHandle;
using mindcraft::BrainRuntime;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FiberRecord;
using mindcraft::FiberScheduler;
using mindcraft::Handle;
using mindcraft::HandleState;
using mindcraft::HandleTable;
using mindcraft::HostActionBinding;
using mindcraft::mc_number_t;
using mindcraft::Op;
using mindcraft::ProgramImage;
using mindcraft::RegionArena;
using mindcraft::RunResult;
using mindcraft::RunStatus;
using mindcraft::RuntimeSurface;
using mindcraft::Span;
using mindcraft::Status;
using mindcraft::TargetHostFuncBinding;
using mindcraft::Value;
using mindcraft::VmObserver;
using mindcraft::test::kAsyncDeviceProfileCaps;

namespace {

// Test-only stable ids: a target-range async host function plus two host actions
// (the per-tick pump and a resume-order recorder).
constexpr uint32_t kAsyncFnId = 1500;
constexpr uint32_t kResolveNowFnId = 1501;
constexpr uint32_t kPumpActionId = 100;
constexpr uint32_t kRecordActionId = 101;
constexpr uint32_t kAsyncActionId = 102;

enum class SettleMode : uint8_t { Resolve = 0, Reject = 1, Cancel = 2 };

/**
 * Deterministic async test capability: an async host function records each handle
 * against a fixed target tick and a settle mode; a per-tick pump host action
 * settles every handle whose target tick has arrived. The settle is enqueue-only
 * (it flips the handle and queues it); the scheduler's post-tick drain resumes
 * the waiters, so a resume always lands on the round after the settling tick.
 */
struct AsyncSettleScheduler {
  struct Entry {
    AsyncHandle handle;
    uint32_t targetTick;
    SettleMode mode;
    mc_number_t value;
    bool active;
  };

  std::array<Entry, 16> entries{};

  void schedule(AsyncHandle handle, uint32_t targetTick, SettleMode mode, mc_number_t value) {
    for (Entry& e : entries) {
      if (!e.active) {
        e = Entry{handle, targetTick, mode, value, true};
        return;
      }
    }
  }

  void pump(uint32_t currentTick) {
    for (Entry& e : entries) {
      if (!e.active || currentTick < e.targetTick) {
        continue;
      }
      switch (e.mode) {
      case SettleMode::Resolve:
        e.handle.resolve(Value::number(e.value));
        break;
      case SettleMode::Reject:
        e.handle.reject(ErrorCode::HostError);
        break;
      case SettleMode::Cancel:
        e.handle.cancel();
        break;
      }
      e.active = false;
    }
  }
};

Status execAsyncSettle(void* hostData, ExecutionContext&, Span<const Value> args,
                       AsyncHandle handle) {
  AsyncSettleScheduler& s = *static_cast<AsyncSettleScheduler*>(hostData);
  const uint32_t targetTick =
      !args.empty() && args[0].isNumber() ? static_cast<uint32_t>(args[0].asNumber()) : 0;
  const SettleMode mode = args.size() > 1 && args[1].isNumber()
                              ? static_cast<SettleMode>(static_cast<uint8_t>(args[1].asNumber()))
                              : SettleMode::Resolve;
  const mc_number_t value = args.size() > 2 && args[2].isNumber() ? args[2].asNumber() : 0;
  s.schedule(handle, targetTick, mode, value);
  return Status::ok();
}

// The host-action form of the async settle capability, dispatched by
// HOST_ACTION_CALL_ASYNC; it shares the settle scheduler with the host-function
// form.
Status execAsyncSettleAction(void* hostData, ExecutionContext& ctx, Span<const Value> args,
                             AsyncHandle handle) {
  return execAsyncSettle(hostData, ctx, args, handle);
}

// An async function that resolves its handle synchronously in its own body, so a
// following AWAIT sees a settled handle and resumes inline in the same slice.
Status execAsyncResolveNow(void* hostData, ExecutionContext&, Span<const Value> args,
                           AsyncHandle handle) {
  static_cast<void>(hostData);
  const mc_number_t value = !args.empty() && args[0].isNumber() ? args[0].asNumber() : 0;
  handle.resolve(Value::number(value));
  return Status::ok();
}

Value execPump(void* hostData, ExecutionContext& ctx, Span<const Value>) {
  static_cast<AsyncSettleScheduler*>(hostData)->pump(ctx.currentTick);
  return mindcraft::kVoidValue;
}

Value execRecord(void*, ExecutionContext&, Span<const Value>) { return mindcraft::kVoidValue; }

/** Records resume-order markers (record action arg 0) and fiber faults. */
struct AsyncObserver : VmObserver {
  std::vector<mc_number_t> recorded;
  std::vector<uint32_t> faultedFibers;
  std::vector<ErrorCode> faultCodes;

  void onHostActionCall(uint32_t actionId, uint32_t, Span<const Value> args,
                        const Value&) override {
    if (actionId == kRecordActionId && !args.empty() && args[0].isNumber()) {
      recorded.push_back(args[0].asNumber());
    }
  }

  void onFiberFault(uint32_t fiberId, ErrorCode code) override {
    faultedFibers.push_back(fiberId);
    faultCodes.push_back(code);
  }
};

/** A shared region sized for a handful of fibers' records and execution regions. */
struct SchedulerStorage {
  static constexpr size_t kArenaBytes = 12 * (2048 + sizeof(FiberRecord) + 64) + 256;
  std::array<uint8_t, kArenaBytes> bytes;
  RegionArena arena{Span<uint8_t>(bytes.data(), bytes.size())};
};

/**
 * One page with a pump rule (root 0) and an awaiter rule (root 1). The awaiter
 * schedules its handle for tick 3 under `mode`, awaits it, and on a resolved
 * resume stores the resolved value into brain variable 0.
 */
ProgramImage buildSingleAwaiterProgram(ProgramBuilder& b, std::vector<uint8_t>& storage,
                                       SettleMode mode) {
  b.poolString("page-id");
  b.poolString("result");
  b.number(3);                                              // 0: target tick
  b.number(static_cast<float>(static_cast<uint8_t>(mode))); // 1: settle mode
  b.number(42);                                             // 2: resolved value
  b.valueNil();                                             // value const 0
  b.brainVariable(1);                                       // var slot 0 "result"

  b.beginFunction().instr(Op::HOST_ACTION_CALL, kPumpActionId, 0, 0).instr(Op::RET);

  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::PUSH_CONST_NUM, 2)
      .instr(Op::HOST_CALL_ASYNC, kAsyncFnId, 3, 0)
      .instr(Op::AWAIT)
      .instr(Op::STORE_VAR_SLOT, 0)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);

  b.beginPage(0).pageRoot(0).pageRoot(1).pageHostCallSite(0, kPumpActionId);
  return b.build(storage);
}

/** A standard async surface over `actions`/`hostFns`. */
struct AsyncFixture {
  ProgramBuilder builder;
  std::vector<uint8_t> storage = std::vector<uint8_t>(16 * 1024);
  AsyncSettleScheduler asyncSched;
  ExecutionContext ctx;
  AsyncObserver observer;
  SchedulerStorage pools;
};

} // namespace

TEST_CASE("AWAIT on a pending handle parks the fiber and resumes on the round after it settles") {
  AsyncFixture fx;
  const ProgramImage image = buildSingleAwaiterProgram(fx.builder, fx.storage, SettleMode::Resolve);

  const TargetHostFuncBinding hostFns[1] = {
      {kAsyncFnId, nullptr, &fx.asyncSched, &execAsyncSettle}};
  const HostActionBinding actions[1] = {{kPumpActionId, &execPump, nullptr, &fx.asyncSched}};
  RuntimeSurface surface{&fx.ctx, {actions, 1}, &fx.observer};
  surface.hostFunctions = {hostFns, 1};

  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  // The handle settles on tick 3; the awaiter is still parked through tick 3 and
  // resumes (writing the variable) only on tick 4.
  for (int i = 1; i <= 3; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
    CHECK_FALSE(fx.ctx.variables[0].isNumber());
  }
  REQUIRE(brain.think(64.0f).isOk());
  REQUIRE(fx.ctx.variables[0].isNumber());
  CHECK(fx.ctx.variables[0].asNumber() == 42.0f);
  CHECK(fx.observer.faultedFibers.empty());
}

TEST_CASE("a rejected handle throws into the awaiting fiber and faults it") {
  AsyncFixture fx;
  const ProgramImage image = buildSingleAwaiterProgram(fx.builder, fx.storage, SettleMode::Reject);

  const TargetHostFuncBinding hostFns[1] = {
      {kAsyncFnId, nullptr, &fx.asyncSched, &execAsyncSettle}};
  const HostActionBinding actions[1] = {{kPumpActionId, &execPump, nullptr, &fx.asyncSched}};
  RuntimeSurface surface{&fx.ctx, {actions, 1}, &fx.observer};
  surface.hostFunctions = {hostFns, 1};

  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  for (int i = 1; i <= 4; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
  }
  // The variable is never written; the awaiter faulted with the handle's error.
  CHECK_FALSE(fx.ctx.variables[0].isNumber());
  REQUIRE_FALSE(fx.observer.faultCodes.empty());
  CHECK(fx.observer.faultCodes[0] == ErrorCode::HostError);
}

TEST_CASE("a cancelled handle faults the awaiting fiber with Cancelled") {
  AsyncFixture fx;
  const ProgramImage image = buildSingleAwaiterProgram(fx.builder, fx.storage, SettleMode::Cancel);

  const TargetHostFuncBinding hostFns[1] = {
      {kAsyncFnId, nullptr, &fx.asyncSched, &execAsyncSettle}};
  const HostActionBinding actions[1] = {{kPumpActionId, &execPump, nullptr, &fx.asyncSched}};
  RuntimeSurface surface{&fx.ctx, {actions, 1}, &fx.observer};
  surface.hostFunctions = {hostFns, 1};

  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  for (int i = 1; i <= 4; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
  }
  CHECK_FALSE(fx.ctx.variables[0].isNumber());
  REQUIRE_FALSE(fx.observer.faultCodes.empty());
  CHECK(fx.observer.faultCodes[0] == ErrorCode::Cancelled);
}

TEST_CASE("multiple fibers awaiting one handle resume in the order they began waiting") {
  AsyncFixture fx;

  ProgramBuilder& b = fx.builder;
  b.poolString("page-id");
  b.poolString("handle");
  b.number(3);        // 0: target tick
  b.number(0);        // 1: resolve mode
  b.number(42);       // 2: resolved value
  b.number(1);        // 3: marker A
  b.number(2);        // 4: marker B
  b.number(3);        // 5: marker C
  b.valueNil();       // value const 0
  b.brainVariable(1); // var slot 0 "handle"

  // root 0: pump
  b.beginFunction().instr(Op::HOST_ACTION_CALL, kPumpActionId, 0, 0).instr(Op::RET);
  // root 1: awaiter A creates the shared handle, stores it, awaits, records 1
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::PUSH_CONST_NUM, 2)
      .instr(Op::HOST_CALL_ASYNC, kAsyncFnId, 3, 0)
      .instr(Op::STORE_VAR_SLOT, 0)
      .instr(Op::LOAD_VAR_SLOT, 0)
      .instr(Op::AWAIT)
      .instr(Op::PUSH_CONST_NUM, 3)
      .instr(Op::HOST_ACTION_CALL, kRecordActionId, 1, 1)
      .instr(Op::POP)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  // root 2: awaiter B awaits the shared handle, records 2
  b.beginFunction()
      .instr(Op::LOAD_VAR_SLOT, 0)
      .instr(Op::AWAIT)
      .instr(Op::PUSH_CONST_NUM, 4)
      .instr(Op::HOST_ACTION_CALL, kRecordActionId, 1, 1)
      .instr(Op::POP)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  // root 3: awaiter C awaits the shared handle, records 3
  b.beginFunction()
      .instr(Op::LOAD_VAR_SLOT, 0)
      .instr(Op::AWAIT)
      .instr(Op::PUSH_CONST_NUM, 5)
      .instr(Op::HOST_ACTION_CALL, kRecordActionId, 1, 1)
      .instr(Op::POP)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  b.beginPage(0)
      .pageRoot(0)
      .pageRoot(1)
      .pageRoot(2)
      .pageRoot(3)
      .pageHostCallSite(0, kPumpActionId)
      .pageHostCallSite(1, kRecordActionId);
  const ProgramImage image = b.build(fx.storage);

  const TargetHostFuncBinding hostFns[1] = {
      {kAsyncFnId, nullptr, &fx.asyncSched, &execAsyncSettle}};
  const HostActionBinding actions[2] = {{kPumpActionId, &execPump, nullptr, &fx.asyncSched},
                                        {kRecordActionId, &execRecord, nullptr, nullptr}};
  RuntimeSurface surface{&fx.ctx, {actions, 2}, &fx.observer};
  surface.hostFunctions = {hostFns, 1};

  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  for (int i = 1; i <= 4; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
  }
  REQUIRE(fx.observer.recorded.size() == 3);
  CHECK(fx.observer.recorded[0] == 1.0f);
  CHECK(fx.observer.recorded[1] == 2.0f);
  CHECK(fx.observer.recorded[2] == 3.0f);
  CHECK(fx.observer.faultedFibers.empty());
}

TEST_CASE("AWAIT on an already-resolved handle resumes inline in the same slice") {
  AsyncFixture fx;
  ProgramBuilder& b = fx.builder;
  b.poolString("page-id");
  b.poolString("result");
  b.number(7);        // 0: resolved value
  b.valueNil();       // value const 0
  b.brainVariable(1); // var slot 0

  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::HOST_CALL_ASYNC, kResolveNowFnId, 1, 0)
      .instr(Op::AWAIT)
      .instr(Op::STORE_VAR_SLOT, 0)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  b.beginPage(0).pageRoot(0);
  const ProgramImage image = b.build(fx.storage);

  const TargetHostFuncBinding hostFns[1] = {
      {kResolveNowFnId, nullptr, nullptr, &execAsyncResolveNow}};
  RuntimeSurface surface{&fx.ctx, {}, &fx.observer};
  surface.hostFunctions = {hostFns, 1};

  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  // One think resolves and consumes the handle without ever parking.
  REQUIRE(brain.think(16.0f).isOk());
  REQUIRE(fx.ctx.variables[0].isNumber());
  CHECK(fx.ctx.variables[0].asNumber() == 7.0f);
}

TEST_CASE("AWAIT inside a sync action frame faults ScriptError") {
  ProgramBuilder b;
  b.valueNil();
  b.beginFunction().instr(Op::AWAIT).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  REQUIRE(mindcraft::startExecution(machine.state, image, 0, {}).isOk());
  // Mark the entry frame as a synchronous action frame; an AWAIT in it cannot
  // suspend and must fault before touching the handle table.
  machine.state.frames[0].hasActionBinding = true;
  machine.state.frames[0].actionBinding = mindcraft::ActionFrameBinding{0, 0, false};
  machine.state.budget = 10;
  const RunResult result = mindcraft::runExecution(machine.state, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::ScriptError);
}

TEST_CASE("AWAIT with no async capability configured faults HostError") {
  ProgramBuilder b;
  b.valueNil();
  // Push a (bogus) handle value, then await it with no handle table on the
  // surface: the async capability is absent.
  b.beginFunction().instr(Op::AWAIT).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  REQUIRE(mindcraft::startExecution(machine.state, image, 0, {}).isOk());
  machine.state.stack[machine.state.stackDepth++] = Value::handle(1);
  machine.state.budget = 10;
  const RunResult result = mindcraft::runExecution(machine.state, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::HostError);
}

TEST_CASE("HOST_ACTION_CALL_ASYNC dispatches an async host action and AWAIT resumes its handle") {
  AsyncFixture fx;
  ProgramBuilder& b = fx.builder;
  b.poolString("page-id");
  b.poolString("result");
  b.number(3);  // 0: target tick
  b.number(0);  // 1: resolve mode
  b.number(42); // 2: resolved value
  b.valueNil(); // value const 0
  b.brainVariable(1);

  b.beginFunction().instr(Op::HOST_ACTION_CALL, kPumpActionId, 0, 0).instr(Op::RET);
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::PUSH_CONST_NUM, 2)
      .instr(Op::HOST_ACTION_CALL_ASYNC, kAsyncActionId, 3, 1)
      .instr(Op::AWAIT)
      .instr(Op::STORE_VAR_SLOT, 0)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  b.beginPage(0)
      .pageRoot(0)
      .pageRoot(1)
      .pageHostCallSite(0, kPumpActionId)
      .pageHostCallSite(1, kAsyncActionId);
  const ProgramImage image = b.build(fx.storage);

  const HostActionBinding actions[2] = {
      {kPumpActionId, &execPump, nullptr, &fx.asyncSched},
      {kAsyncActionId, nullptr, nullptr, &fx.asyncSched, &execAsyncSettleAction}};
  RuntimeSurface surface{&fx.ctx, {actions, 2}, &fx.observer};

  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());

  for (int i = 1; i <= 3; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
    CHECK_FALSE(fx.ctx.variables[0].isNumber());
  }
  REQUIRE(brain.think(64.0f).isOk());
  REQUIRE(fx.ctx.variables[0].isNumber());
  CHECK(fx.ctx.variables[0].asNumber() == 42.0f);
  CHECK(fx.observer.faultedFibers.empty());
}

TEST_CASE("spawnAsyncActionChild runs a bytecode action child and resolves its result handle") {
  // The scheduler half of ACTION_CALL_ASYNC: a child fiber runs an action body
  // to completion and its return value settles the result handle the dispatch
  // arm pushed for the awaiting parent.
  AsyncFixture fx;
  ProgramBuilder& b = fx.builder;
  b.poolString("page-id");
  b.number(99); // const 0: the action body's return value
  b.valueNil(); // value const 0
  // func 0: page root (unused here). func 1: action body pushing 99 then RET.
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::RET);
  b.beginPage(0).pageRoot(0);
  const ProgramImage image = b.build(fx.storage);

  RuntimeSurface surface{&fx.ctx, {}, &fx.observer};
  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);

  ErrorCode err = ErrorCode::HostError;
  const uint32_t hid = scheduler.spawnAsyncActionChild(1, 0, 0, mindcraft::kNoFuncId, {}, err);
  REQUIRE(hid != mindcraft::kNoHandleId);
  Handle* pending = scheduler.handles().get(hid);
  REQUIRE(pending != nullptr);
  CHECK(pending->state == HandleState::Pending);

  // One round runs the child to Done, resolving the handle to the returned value.
  scheduler.tick();
  Handle* settled = scheduler.handles().get(hid);
  REQUIRE(settled != nullptr);
  CHECK(settled->state == HandleState::Resolved);
  CHECK(settled->result.asNumber() == 99.0f);
}

TEST_CASE("a faulting bytecode action child rejects its result handle") {
  AsyncFixture fx;
  ProgramBuilder& b = fx.builder;
  b.poolString("page-id");
  b.valueNil();
  // func 0: page root. func 1: a RET with an empty operand stack faults.
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  b.beginFunction().instr(Op::RET);
  b.beginPage(0).pageRoot(0);
  const ProgramImage image = b.build(fx.storage);

  RuntimeSurface surface{&fx.ctx, {}, &fx.observer};
  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);

  ErrorCode err = ErrorCode::HostError;
  const uint32_t hid = scheduler.spawnAsyncActionChild(1, 0, 0, mindcraft::kNoFuncId, {}, err);
  REQUIRE(hid != mindcraft::kNoHandleId);

  scheduler.tick();
  Handle* settled = scheduler.handles().get(hid);
  REQUIRE(settled != nullptr);
  CHECK(settled->state == HandleState::Rejected);
  CHECK_FALSE(fx.observer.faultedFibers.empty());
}

TEST_CASE("cancelling an async-action child cancels its pending result handle") {
  // Without this, a cancelled child would leave its handle pending forever and an
  // awaiting parent would never resume. The child is spawned but not run, so its
  // handle is still pending when it is cancelled.
  AsyncFixture fx;
  ProgramBuilder& b = fx.builder;
  b.poolString("page-id");
  b.valueNil();
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  b.beginPage(0).pageRoot(0);
  const ProgramImage image = b.build(fx.storage);

  RuntimeSurface surface{&fx.ctx, {}, &fx.observer};
  FiberScheduler scheduler(image, surface, fx.pools.arena, kAsyncDeviceProfileCaps);

  ErrorCode err = ErrorCode::HostError;
  const uint32_t hid = scheduler.spawnAsyncActionChild(1, 0, 0, mindcraft::kNoFuncId, {}, err);
  REQUIRE(hid != mindcraft::kNoHandleId);
  REQUIRE(scheduler.handles().get(hid)->state == HandleState::Pending);

  // The first child draws the top of the descending inline fiber id space.
  scheduler.cancel(0xffffffffu);
  Handle* settled = scheduler.handles().get(hid);
  REQUIRE(settled != nullptr);
  CHECK(settled->state == HandleState::Cancelled);
}

TEST_CASE("the handle table guards its cap and settles only from pending") {
  std::array<uint8_t, 4096> bytes{};
  RegionArena arena(Span<uint8_t>(bytes.data(), bytes.size()));
  HandleTable handles(arena, 2);

  const uint32_t a = handles.createPending();
  const uint32_t b = handles.createPending();
  CHECK(a != mindcraft::kNoHandleId);
  CHECK(b != mindcraft::kNoHandleId);
  // The cap is a guard: a third handle past maxHandles fails to carve.
  CHECK(handles.createPending() == mindcraft::kNoHandleId);

  CHECK(handles.resolve(a, Value::number(1)));
  // A second settle of the same handle is illegal and is a no-op.
  CHECK_FALSE(handles.resolve(a, Value::number(2)));
  CHECK_FALSE(handles.reject(a, ErrorCode::HostError));

  Handle* ha = handles.get(a);
  REQUIRE(ha != nullptr);
  CHECK(ha->state == HandleState::Resolved);

  // The settled handle is on the completed queue exactly once.
  CHECK(handles.popCompleted() == ha);
  CHECK(handles.popCompleted() == nullptr);
}
