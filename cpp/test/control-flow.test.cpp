#include "doctest/doctest.h"

#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "vm-harness.h"

#include <cstdint>
#include <vector>

using mindcraft::CoreTypeAtomId;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FiberRecord;
using mindcraft::FiberScheduler;
using mindcraft::FiberState;
using mindcraft::kMaxFrameDepth;
using mindcraft::kMaxHandlers;
using mindcraft::kMaxLocalsSize;
using mindcraft::kMaxStackSize;
using mindcraft::ManagedHeap;
using mindcraft::Op;
using mindcraft::ProgramImage;
using mindcraft::RegionArena;
using mindcraft::Result;
using mindcraft::RunResult;
using mindcraft::RunStatus;
using mindcraft::RuntimeSurface;
using mindcraft::Span;
using mindcraft::Status;
using mindcraft::Value;
using mindcraft::ValueTag;
using mindcraft::VmObserver;

namespace {

/** Records the fault code of each faulted fiber, for the overflow assertions. */
struct FaultObserver : VmObserver {
  std::vector<ErrorCode> codes;
  void onHostActionCall(uint32_t, uint32_t, Span<const Value>, const Value&) override {}
  void onFiberFault(uint32_t, ErrorCode code) override { codes.push_back(code); }
};

} // namespace

// --- Exception handling: TRY / END_TRY / THROW ---------------------------------

TEST_CASE("THROW caught in the same frame delivers an Err value at the catch target") {
  // TRY (catch at +3), throw a non-error value, and the catch (which the throw
  // jumps to) type-checks the delivered value: it must be an Err carrying the
  // synthesized classifier.
  ProgramBuilder b;
  b.number(9.0f);
  b.beginFunction()
      .instr(Op::TRY, 3)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::THROW)
      .instr(Op::TYPE_CHECK, static_cast<int32_t>(ValueTag::Err))
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.tag() == ValueTag::Boolean);
  CHECK(result.result.asBoolean());
  // The handler was consumed by the throw, and only the delivered value remains.
  CHECK(machine.state.handlerDepth == 0);
}

TEST_CASE("END_TRY pops the handler so a later THROW is uncaught") {
  // TRY then END_TRY removes the handler; the subsequent THROW then finds no
  // handler and faults.
  ProgramBuilder b;
  b.number(9.0f);
  b.beginFunction()
      .instr(Op::TRY, 4)
      .instr(Op::END_TRY)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::THROW)
      .instr(Op::RET); // the catch target, never reached
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::ScriptError);
  CHECK(result.site.pc == 3);
}

TEST_CASE("an uncaught THROW faults with the thrown classifier") {
  ProgramBuilder b;
  b.number(9.0f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::THROW).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::ScriptError);
  CHECK(result.site.pc == 1);
}

TEST_CASE("THROW unwinds across a called frame to an outer handler") {
  // func 0 guards a call to func 1, which throws; the throw must pop func 1's
  // frame, restore the stack and locals, and resume func 0 at its catch target.
  ProgramBuilder b;
  b.number(42.0f).number(7.0f);
  // func 0: TRY (catch at +3), call func 1, (unreached) RET; catch drops the
  // error value and returns 42.
  b.beginFunction()
      .instr(Op::TRY, 3)
      .instr(Op::CALL, 1, 0)
      .instr(Op::RET)
      .instr(Op::POP)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::RET);
  // func 1: throw a value (no handler of its own).
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 1).instr(Op::THROW);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  // Reaching func 0's catch and returning 42 proves the callee frame was
  // unwound and func 0 resumed at its catch target.
  CHECK(result.result.asNumber() == 42.0f);
  CHECK(machine.state.handlerDepth == 0);
}

TEST_CASE("re-throwing a caught error value re-enters the exception path with its classifier") {
  // An inner catch re-throws the Err value it received; the outer catch then
  // type-checks the delivered value to confirm a re-thrown error stays an Err.
  ProgramBuilder b;
  b.number(9.0f);
  b.beginFunction()
      .instr(Op::TRY, 5)            // outer handler, catch at index 5
      .instr(Op::TRY, 3)            // inner handler, catch at index 4
      .instr(Op::PUSH_CONST_NUM, 0) // a non-error throw value
      .instr(Op::THROW)             // caught by inner -> index 4
      .instr(Op::THROW)             // re-throw the Err value -> caught by outer -> index 5
      .instr(Op::TYPE_CHECK, static_cast<int32_t>(ValueTag::Err))
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.tag() == ValueTag::Boolean);
  CHECK(result.result.asBoolean());
  CHECK(machine.state.handlerDepth == 0);
}

TEST_CASE("the handler stack faults StackOverflow at its cap") {
  // A loop that pushes a handler each iteration without popping; the push past
  // kMaxHandlers faults.
  ProgramBuilder b;
  b.beginFunction().instr(Op::TRY, 1).instr(Op::JMP, -1);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image, {}, 1000);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::StackOverflow);
  CHECK(machine.state.handlerDepth == kMaxHandlers);
}

// --- Cooperative YIELD ----------------------------------------------------------

TEST_CASE("YIELD suspends the fiber to the next round and preserves locals") {
  // Park a value in a local, YIELD, then return it: the value surviving the
  // round boundary proves the suspended region was retained.
  ProgramBuilder b;
  b.valueBool(true);
  b.beginFunction(0, 1)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::STORE_LOCAL, 0)
      .instr(Op::YIELD)
      .instr(Op::LOAD_LOCAL, 0)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  std::vector<uint8_t> arenaStorage(16 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  FiberScheduler scheduler(image, surface, arena);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());
  const uint32_t fiberId = spawned.value();

  // First round: the slice yields and the fiber stays runnable for the next.
  CHECK(scheduler.tick() == 1);
  const FiberRecord* suspended = scheduler.fiber(fiberId);
  REQUIRE(suspended != nullptr);
  CHECK(suspended->state == FiberState::Runnable);

  // It received no second slice within the round; the next round resumes it.
  CHECK(scheduler.tick() == 1);
  const FiberRecord* finished = scheduler.fiber(fiberId);
  REQUIRE(finished != nullptr);
  CHECK(finished->state == FiberState::Done);
  REQUIRE(finished->exec.stackDepth == 1);
  CHECK(finished->exec.stack[0].tag() == ValueTag::Boolean);
  CHECK(finished->exec.stack[0].asBoolean());
}

TEST_CASE("a YIELD inside a sync action hook faults ScriptError and the hook runner reports it") {
  // A page-lifecycle hook runs as a sync action frame, so its YIELD cannot
  // suspend: the dispatch loop faults ScriptError and runActionHook returns it.
  ProgramBuilder b;
  b.valueNil();
  b.beginFunction().instr(Op::YIELD).instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  RuntimeSurface surface{&ctx, {}, nullptr};
  std::vector<uint8_t> arenaStorage(16 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  FiberScheduler scheduler(image, surface, arena);

  const Status hook = scheduler.runActionHook(0, 0, 0);
  CHECK_FALSE(hook.isOk());
  CHECK(hook.error() == ErrorCode::ScriptError);
}

TEST_CASE("STORE_CALLSITE_VAR outside any action frame faults ScriptError") {
  // A rule fiber carries no action binding, so a callsite-var store finds no
  // bound call site and faults.
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::STORE_CALLSITE_VAR, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  std::vector<uint8_t> arenaStorage(16 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  REQUIRE(ctx.bindSlots(arena, 0, 1, 1));
  FaultObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  FiberScheduler scheduler(image, surface, arena);
  REQUIRE(scheduler.spawn(0).isOk());

  scheduler.tick();
  REQUIRE(observer.codes.size() == 1);
  CHECK(observer.codes[0] == ErrorCode::ScriptError);
}

// --- Grow-on-demand regions reach the caps and fault StackOverflow --------------

TEST_CASE("the operand stack grows on demand and faults StackOverflow at its cap") {
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::JMP, -1);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  FaultObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  FiberScheduler scheduler(image, surface, arena);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());

  CHECK(scheduler.tick() == 1);
  REQUIRE(observer.codes.size() == 1);
  CHECK(observer.codes[0] == ErrorCode::StackOverflow);
  const FiberRecord* record = scheduler.fiber(spawned.value());
  REQUIRE(record != nullptr);
  // The region grew from its small initial size all the way to the cap.
  CHECK(record->exec.stackDepth == kMaxStackSize);
  CHECK(record->exec.stackCapacity == kMaxStackSize);
}

TEST_CASE("the frame stack grows on demand and faults StackOverflow at its cap") {
  ProgramBuilder b;
  b.beginFunction().instr(Op::CALL, 0, 0).instr(Op::RET); // unbounded recursion
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  FaultObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  FiberScheduler scheduler(image, surface, arena);
  REQUIRE(scheduler.spawn(0).isOk());

  CHECK(scheduler.tick() == 1);
  REQUIRE(observer.codes.size() == 1);
  CHECK(observer.codes[0] == ErrorCode::StackOverflow);
}

TEST_CASE("the locals region faults StackOverflow before the frame cap when locals dominate") {
  // Five locals per frame reaches the locals cap (256) at frame 52, below the
  // frame cap (64): the locals cap faults first.
  ProgramBuilder b;
  b.beginFunction(0, 5).instr(Op::CALL, 0, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  FaultObserver observer;
  RuntimeSurface surface{&ctx, {}, &observer};
  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  FiberScheduler scheduler(image, surface, arena);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());

  CHECK(scheduler.tick() == 1);
  REQUIRE(observer.codes.size() == 1);
  CHECK(observer.codes[0] == ErrorCode::StackOverflow);
  const FiberRecord* record = scheduler.fiber(spawned.value());
  REQUIRE(record != nullptr);
  // The locals cap fired with frames still below their own cap.
  CHECK(record->exec.localsDepth + 5u > kMaxLocalsSize);
  CHECK(record->exec.frameDepth < kMaxFrameDepth);
}

// --- Garbage collection over a grown region -------------------------------------

TEST_CASE("the collector traces a grown operand stack") {
  // Push more list values than the initial stack capacity so the region grows,
  // then collect: every list stays reachable through the (relocated) stack.
  constexpr uint32_t kLists = 20;
  ProgramBuilder b;
  b.atomType(CoreTypeAtomId::Number).listType(0);
  b.beginFunction();
  for (uint32_t i = 0; i < kLists; i++) {
    b.instr(Op::LIST_NEW, 0, 1); // reserved a:0, list type at index 1
  }
  b.instr(Op::YIELD);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  ExecutionContext ctx;
  std::vector<uint8_t> arenaStorage(64 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  ManagedHeap heap(arena);
  RuntimeSurface surface{&ctx, {}, nullptr, &heap};
  FiberScheduler scheduler(image, surface, arena);
  const Result<uint32_t> spawned = scheduler.spawn(0);
  REQUIRE(spawned.isOk());

  // One round runs the list builds and yields at the cliff.
  CHECK(scheduler.tick() == 1);
  const FiberRecord* record = scheduler.fiber(spawned.value());
  REQUIRE(record != nullptr);
  CHECK(record->state == FiberState::Runnable);
  REQUIRE(record->exec.stackDepth == kLists);
  // The stack outgrew its initial capacity.
  CHECK(record->exec.stackCapacity > mindcraft::kInitialStackSlots);
  CHECK(heap.liveListCount() == kLists);

  // A collection over the scheduler's roots must keep every list reachable
  // through the grown stack.
  heap.collect(scheduler);
  CHECK(heap.liveListCount() == kLists);
}
