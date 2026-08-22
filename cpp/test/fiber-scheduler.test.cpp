#include "doctest/doctest.h"

#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/host-action.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <vector>

using wendoo::ErrorCode;
using wendoo::ExecutionContext;
using wendoo::FiberRecord;
using wendoo::FiberScheduler;
using wendoo::FiberState;
using wendoo::Frame;
using wendoo::HostActionBinding;
using wendoo::kNoTypeIdx;
using wendoo::ManagedHeap;
using wendoo::MapKey;
using wendoo::Op;
using wendoo::ProgramImage;
using wendoo::RegionArena;
using wendoo::Result;
using wendoo::RuntimeSurface;
using wendoo::Span;
using wendoo::Value;
using wendoo::ValueTag;
using wendoo::VmObserver;
using wendoo::test::kDeviceProfileCaps;

namespace {

/**
 * A generous upper bound on the arena bytes one fiber consumes: its four
 * grow-on-demand execution regions (slab blocks at their initial sizes, with
 * room to grow) plus its record. The regions no longer reserve the worst-case
 * caps, so this is far below the retired per-fiber workspace size; it stays an
 * over-estimate so the count guard, not memory, governs the spawn tests.
 */
constexpr size_t kPerFiberArenaBytes = 2048 + sizeof(wendoo::FiberRecord);

/** One shared region with room for several fibers' regions and records; tests spawn a few. */
struct SchedulerStorage {
  static constexpr size_t kArenaBytes = 8 * (kPerFiberArenaBytes + 64) + 256;
  std::array<uint8_t, kArenaBytes> bytes;
  RegionArena arena{Span<uint8_t>(bytes.data(), bytes.size())};
};

/** Observer recording dispatch and fault order for assertions. */
struct OrderObserver : VmObserver {
  std::vector<uint32_t> actionIds;
  std::vector<uint32_t> faultedFibers;
  std::vector<ErrorCode> faultCodes;

  void onHostActionCall(uint32_t actionId, uint32_t, Span<const Value>, const Value&) override {
    actionIds.push_back(actionId);
  }

  void onFiberFault(uint32_t fiberId, ErrorCode code) override {
    faultedFibers.push_back(fiberId);
    faultCodes.push_back(code);
  }
};

Value execNoop(void*, ExecutionContext&, Span<const Value>) { return wendoo::kVoidValue; }

/** A number-keyed map key. */
MapKey numKey(float n) { return MapKey{true, false, n, 0}; }

/** A one-rule program whose body completes in a handful of instructions. */
ProgramImage shortProgram(ProgramBuilder& b, std::vector<uint8_t>& storage) {
  b.valueNil();
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  return b.build(storage);
}

} // namespace

TEST_CASE("a round gives every fiber queued at entry exactly one slice, FIFO") {
  // Two fibers each dispatch a distinct action; the round runs both in spawn
  // order within one tick.
  ProgramBuilder b;
  b.valueNil();
  b.beginFunction().instr(Op::HOST_ACTION_CALL, 1, 0, 0).instr(Op::RET);
  b.beginFunction().instr(Op::HOST_ACTION_CALL, 2, 0, 1).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  const HostActionBinding bindings[2] = {{1, &execNoop, nullptr, nullptr},
                                         {2, &execNoop, nullptr, nullptr}};
  ExecutionContext ctx;
  OrderObserver observer;
  RuntimeSurface surface{&ctx, {bindings, 2}, &observer};

  SchedulerStorage pools;
  REQUIRE(ctx.bindSlots(pools.arena, 0, 2));
  FiberScheduler scheduler(image, surface, pools.arena, kDeviceProfileCaps);
  REQUIRE(scheduler.spawn(0).isOk());
  REQUIRE(scheduler.spawn(1).isOk());

  CHECK(scheduler.tick() == 2);
  REQUIRE(observer.actionIds.size() == 2);
  CHECK(observer.actionIds[0] == 1);
  CHECK(observer.actionIds[1] == 2);
  CHECK(scheduler.tick() == 0);
}

TEST_CASE("budget exhaustion suspends mid-body and resumes in the next round") {
  // The body parks a value in a local, burns through more than one budget
  // slice of straight-line work, then returns the parked value: completion
  // proves the suspended region survived the round boundary intact.
  ProgramBuilder b;
  b.valueNil().valueBool(true);
  b.beginFunction(0, 1);
  b.instr(Op::PUSH_CONST_VAL, 1).instr(Op::STORE_LOCAL, 0);
  for (int i = 0; i < 600; i++) {
    b.instr(Op::PUSH_CONST_VAL, 0).instr(Op::POP);
  }
  b.instr(Op::LOAD_LOCAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(64 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena, kDeviceProfileCaps);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());
  const uint32_t fiberId = spawned.value();

  // First round: the slice exhausts mid-body and the fiber stays runnable.
  CHECK(scheduler.tick() == 1);
  const FiberRecord* suspended = scheduler.fiber(fiberId);
  REQUIRE(suspended != nullptr);
  CHECK(suspended->state == FiberState::Runnable);
  CHECK(suspended->exec.budget == 0);
  CHECK(suspended->exec.frames[0].pc < 1204);
  scheduler.sweep();
  CHECK(scheduler.fiber(fiberId) != nullptr);

  // It received no second slice within the round; the next round resumes and
  // completes it.
  CHECK(scheduler.tick() == 1);
  const FiberRecord* finished = scheduler.fiber(fiberId);
  REQUIRE(finished != nullptr);
  CHECK(finished->state == FiberState::Done);
  REQUIRE(finished->exec.stackDepth == 1);
  CHECK(finished->exec.stack[0].tag() == ValueTag::Boolean);
  CHECK(finished->exec.stack[0].asBoolean());

  scheduler.sweep();
  CHECK(scheduler.fiber(fiberId) == nullptr);
  CHECK(scheduler.liveCount() == 0);
}

TEST_CASE("a faulting fiber reports through the observer and dies") {
  ProgramBuilder b;
  b.beginFunction().instr(Op::POP).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  OrderObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena, kDeviceProfileCaps);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());

  CHECK(scheduler.tick() == 1);
  REQUIRE(observer.faultedFibers.size() == 1);
  CHECK(observer.faultedFibers[0] == spawned.value());
  CHECK(observer.faultCodes[0] == ErrorCode::StackUnderflow);
  const FiberRecord* record = scheduler.fiber(spawned.value());
  REQUIRE(record != nullptr);
  CHECK(record->state == FiberState::Fault);

  scheduler.sweep();
  CHECK(scheduler.fiber(spawned.value()) == nullptr);
}

TEST_CASE("spawn exhausting the region faults loudly and recovers after a sweep") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = shortProgram(b, storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  // A region sized for only a couple of fibers, so spawning soon exhausts it.
  std::array<uint8_t, 2 * kPerFiberArenaBytes + 256> arenaBytes;
  RegionArena arena(Span<uint8_t>(arenaBytes.data(), arenaBytes.size()));
  FiberScheduler scheduler(image, surface, arena, kDeviceProfileCaps);

  uint32_t spawned = 0;
  while (scheduler.spawn(0).isOk()) {
    spawned++;
    REQUIRE(spawned < 100);
  }
  CHECK(spawned >= 1);
  // The spawn that exhausted the region faulted loudly.
  CHECK(scheduler.spawn(0).error() == ErrorCode::StackOverflow);

  // Running the live fibers to completion and sweeping frees pool slots, so a
  // later spawn reuses them.
  CHECK(scheduler.tick() == spawned);
  scheduler.sweep();
  CHECK(scheduler.liveCount() == 0);
  CHECK(scheduler.spawn(0).isOk());
}

TEST_CASE("spawn past the fiber guard faults loudly with memory to spare") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = shortProgram(b, storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  // Region with room well beyond the fiber cap, so the count guard - not memory
  // - is what fires.
  std::vector<uint8_t> arenaStorage((kDeviceProfileCaps.maxFibers + 8) *
                                    (kPerFiberArenaBytes + 128));
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  FiberScheduler scheduler(image, surface, arena, kDeviceProfileCaps);

  for (uint32_t i = 0; i < kDeviceProfileCaps.maxFibers; i++) {
    REQUIRE(scheduler.spawn(0).isOk());
  }
  CHECK(scheduler.liveCount() == kDeviceProfileCaps.maxFibers);
  const Result<uint32_t> overflow = scheduler.spawn(0);
  REQUIRE(!overflow.isOk());
  CHECK(overflow.error() == ErrorCode::StackOverflow);
}

TEST_CASE("spawn of an invalid funcId propagates the start failure") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = shortProgram(b, storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena, kDeviceProfileCaps);
  const Result<uint32_t> bad = scheduler.spawn(9);
  REQUIRE(!bad.isOk());
  CHECK(bad.error() == ErrorCode::HostError);
  CHECK(scheduler.liveCount() == 0);
  // The failed spawn released its slots: capacity is still fully available.
  for (uint32_t i = 0; i < 8; i++) {
    REQUIRE(scheduler.spawn(0).isOk());
  }
}

TEST_CASE("a cancelled fiber is skipped by the round and reclaimed") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = shortProgram(b, storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena, kDeviceProfileCaps);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());
  scheduler.cancel(spawned.value());

  const FiberRecord* record = scheduler.fiber(spawned.value());
  REQUIRE(record != nullptr);
  CHECK(record->state == FiberState::Cancelled);
  CHECK(scheduler.tick() == 0);
  scheduler.sweep();
  CHECK(scheduler.fiber(spawned.value()) == nullptr);
}

TEST_CASE("a reachable rule-variable store survives collection") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = shortProgram(b, storage);

  std::vector<uint8_t> arenaStorage(16 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  ManagedHeap heap(arena);

  // Build the rule-variable store shape: an outer map keyed by rule funcId,
  // each value an inner map of variable name to value; the value here is a
  // managed list so its survival across collection is observable.
  Value outer;
  REQUIRE(heap.newMap(kNoTypeIdx, nullptr, outer));
  Value inner;
  REQUIRE(heap.newMap(kNoTypeIdx, nullptr, inner));
  Value listValue;
  REQUIRE(heap.newList(kNoTypeIdx, nullptr, listValue));
  REQUIRE(heap.listPush(heap.list(listValue), Value::number(7.0f), nullptr));
  REQUIRE(heap.mapSet(heap.map(inner), numKey(0.0f), listValue, nullptr));
  REQUIRE(heap.mapSet(heap.map(outer), numKey(1.0f), inner, nullptr));

  ExecutionContext ctx;
  ctx.ruleVarStores = outer;
  RuntimeSurface surface{&ctx, {}, nullptr, &heap};
  FiberScheduler scheduler(image, surface, arena, kDeviceProfileCaps);

  heap.collect(scheduler);
  CHECK(heap.liveMapCount() == 2);
  CHECK(heap.liveListCount() == 1);
  CHECK(heap.list(heap.mapGet(heap.map(inner), numKey(0.0f)))->size == 1);

  // Dropping the store from the context makes the whole structure unreachable.
  ctx.ruleVarStores = wendoo::kNilValue;
  heap.collect(scheduler);
  CHECK(heap.liveMapCount() == 0);
  CHECK(heap.liveListCount() == 0);
}

TEST_CASE("a container in a callsite-var slot survives collection") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = shortProgram(b, storage);

  std::vector<uint8_t> arenaStorage(16 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  ManagedHeap heap(arena);

  ExecutionContext ctx;
  // One call site with a two-wide bytecode callsite-var pad.
  REQUIRE(ctx.bindSlots(arena, 0, 1, 2));
  Value listValue;
  REQUIRE(heap.newList(kNoTypeIdx, nullptr, listValue));
  REQUIRE(heap.listPush(heap.list(listValue), Value::number(9.0f), nullptr));
  ctx.setCallSiteSlot(0, 1, listValue);

  RuntimeSurface surface{&ctx, {}, nullptr, &heap};
  FiberScheduler scheduler(image, surface, arena, kDeviceProfileCaps);

  heap.collect(scheduler);
  CHECK(heap.liveListCount() == 1);
  CHECK(heap.list(ctx.callSiteSlot(0, 1))->size == 1);

  // Clearing the slot makes the list unreachable.
  ctx.setCallSiteSlot(0, 1, wendoo::kNilValue);
  heap.collect(scheduler);
  CHECK(heap.liveListCount() == 0);
}
