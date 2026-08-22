/**
 * The per-rule firing record the dispatch loop writes at the WHEN boundary
 * opcodes. Mirrors `rule-firing-record.spec.ts` in
 * external/wendoo-lang/packages/core/src/runtime.
 *
 * `WHEN_START` marks the rule Evaluating; both gates -- the truthiness gate
 * (`WHEN_END`) and the presence gate (`WHEN_END_PRESENT`) -- store the outcome
 * they computed. A presence-gated rule fires on a present falsy value (`0`,
 * `""`, `false`), so the record and the truthiness of the WHEN value differ.
 */

#include "doctest/doctest.h"

#include "core/runtime/bytecode.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/execution-state.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <vector>

using wendoo::ExecutionContext;
using wendoo::Op;
using wendoo::ProgramImage;
using wendoo::RegionArena;
using wendoo::RuleFiringState;
using wendoo::runExecution;
using wendoo::RunResult;
using wendoo::RunStatus;
using wendoo::RuntimeSurface;
using wendoo::Span;
using wendoo::startExecution;
using wendoo::ValueTag;

namespace {

/** The funcId of the single rule function every fixture below runs. */
constexpr uint32_t kRuleFuncId = 0;

/** Records for one rule plus headroom, matching the runtime's funcId indexing. */
constexpr uint32_t kRuleFiringCount = 4;

/**
 * An execution context whose firing records are bound over its own arena, ready
 * to be pointed at by a {@link RuntimeSurface}.
 */
struct FiringContext {
  FiringContext() : arena(Span<uint8_t>(storage.data(), storage.size())) {
    REQUIRE(ctx.bindSlots(arena, 0, 0, 0, 0, kRuleFiringCount));
    surface.context = &ctx;
  }

  std::array<uint8_t, 256> storage;
  RegionArena arena;
  ExecutionContext ctx;
  RuntimeSurface surface;
};

/**
 * A rule function shaped like compiler output: `WHEN_START`, the WHEN value at
 * value-pool index `whenValueIdx`, `gate`, an empty DO, then the end label. Both
 * paths return nil, so the fired / not-fired outcome shows up only in the record.
 */
void appendGatedRule(ProgramBuilder& b, Op gate, int32_t whenValueIdx, int32_t nilValueIdx) {
  b.beginFunction()
      .instr(Op::WHEN_START)
      .instr(Op::PUSH_CONST_VAL, whenValueIdx)
      .instr(gate, 4)
      .instr(Op::DO_START)
      .instr(Op::DO_END)
      .instr(Op::JMP, 1)
      .instr(Op::PUSH_CONST_VAL, nilValueIdx)
      .instr(Op::RET);
}

/**
 * Runs `image`'s rule function 0 to completion with the rule's record seeded to
 * `seed`, and returns the record the run left behind.
 */
RuleFiringState runRuleWithSeed(const ProgramImage& image, RuleFiringState seed) {
  FiringContext fixture;
  fixture.ctx.setRuleFiringState(kRuleFuncId, seed);
  Machine machine;
  const RunResult result = runProgram(machine, image, {}, 1000, fixture.surface);
  REQUIRE(result.status == RunStatus::Done);
  return fixture.ctx.ruleFiringState(kRuleFuncId);
}

} // namespace

TEST_CASE("an unwritten firing record reads as fired") {
  FiringContext fixture;
  for (uint32_t funcId = 0; funcId < kRuleFiringCount; funcId++) {
    CHECK(fixture.ctx.ruleFiringState(funcId) == RuleFiringState::DidFire);
  }
}

TEST_CASE("a firing record write with no rule in scope is dropped") {
  FiringContext fixture;
  fixture.ctx.setRuleFiringState(wendoo::kNoFuncId, RuleFiringState::DidNotFire);
  fixture.ctx.setRuleFiringState(kRuleFiringCount, RuleFiringState::DidNotFire);
  for (uint32_t funcId = 0; funcId < kRuleFiringCount; funcId++) {
    CHECK(fixture.ctx.ruleFiringState(funcId) == RuleFiringState::DidFire);
  }
}

TEST_CASE("an unbound record table drops writes and reads as fired") {
  ExecutionContext ctx;
  ctx.setRuleFiringState(kRuleFuncId, RuleFiringState::DidNotFire);
  CHECK(ctx.ruleFiringState(kRuleFuncId) == RuleFiringState::DidFire);
}

TEST_CASE("the truthiness gate records the rule's firing outcome") {
  ProgramBuilder b;
  b.valueBool(true).valueNil();
  b.ruleFunc(kRuleFuncId);
  appendGatedRule(b, Op::WHEN_END, 0, 1);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage truthy = b.build(storage);
  CHECK(runRuleWithSeed(truthy, RuleFiringState::DidNotFire) == RuleFiringState::DidFire);

  ProgramBuilder f;
  f.valueBool(false).valueNil();
  f.ruleFunc(kRuleFuncId);
  appendGatedRule(f, Op::WHEN_END, 0, 1);
  std::vector<uint8_t> falsyStorage(16 * 1024);
  const ProgramImage falsy = f.build(falsyStorage);
  CHECK(runRuleWithSeed(falsy, RuleFiringState::DidFire) == RuleFiringState::DidNotFire);
}

TEST_CASE("the presence gate records a fire for an absent and a present WHEN value") {
  ProgramBuilder absent;
  absent.valueNil();
  absent.ruleFunc(kRuleFuncId);
  appendGatedRule(absent, Op::WHEN_END_PRESENT, 0, 0);
  std::vector<uint8_t> absentStorage(16 * 1024);
  const ProgramImage absentImage = absent.build(absentStorage);
  CHECK(runRuleWithSeed(absentImage, RuleFiringState::DidFire) == RuleFiringState::DidNotFire);

  ProgramBuilder present;
  present.valueNumber(7.0f).valueNil();
  present.ruleFunc(kRuleFuncId);
  appendGatedRule(present, Op::WHEN_END_PRESENT, 0, 1);
  std::vector<uint8_t> presentStorage(16 * 1024);
  const ProgramImage presentImage = present.build(presentStorage);
  CHECK(runRuleWithSeed(presentImage, RuleFiringState::DidNotFire) == RuleFiringState::DidFire);
}

TEST_CASE("the presence gate records a fire for a present but falsy WHEN value") {
  // Value-pool index 0 is the present falsy value under test; index 1 is the
  // nil the end label returns.
  ProgramBuilder zero;
  zero.valueNumber(0.0f).valueNil();
  zero.ruleFunc(kRuleFuncId);
  appendGatedRule(zero, Op::WHEN_END_PRESENT, 0, 1);
  std::vector<uint8_t> zeroStorage(16 * 1024);
  const ProgramImage zeroImage = zero.build(zeroStorage);
  CHECK(runRuleWithSeed(zeroImage, RuleFiringState::DidNotFire) == RuleFiringState::DidFire);

  ProgramBuilder emptyString;
  emptyString.poolString("");
  emptyString.valueString(0).valueNil();
  emptyString.ruleFunc(kRuleFuncId);
  appendGatedRule(emptyString, Op::WHEN_END_PRESENT, 0, 1);
  std::vector<uint8_t> emptyStringStorage(16 * 1024);
  const ProgramImage emptyStringImage = emptyString.build(emptyStringStorage);
  CHECK(runRuleWithSeed(emptyStringImage, RuleFiringState::DidNotFire) == RuleFiringState::DidFire);

  ProgramBuilder falseValue;
  falseValue.valueBool(false).valueNil();
  falseValue.ruleFunc(kRuleFuncId);
  appendGatedRule(falseValue, Op::WHEN_END_PRESENT, 0, 1);
  std::vector<uint8_t> falseStorage(16 * 1024);
  const ProgramImage falseImage = falseValue.build(falseStorage);
  CHECK(runRuleWithSeed(falseImage, RuleFiringState::DidNotFire) == RuleFiringState::DidFire);
}

TEST_CASE("a WHEN cut short by budget exhaustion leaves the rule evaluating") {
  // WHEN_START then a push/pop run long enough that a budget of 3 stops the
  // state inside the WHEN section, before either gate runs.
  ProgramBuilder b;
  b.valueBool(true).valueNil();
  b.ruleFunc(kRuleFuncId);
  b.beginFunction().instr(Op::WHEN_START);
  for (uint32_t i = 0; i < 10; i++) {
    b.instr(Op::PUSH_CONST_VAL, 0).instr(Op::POP);
  }
  b.instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::WHEN_END, 3)
      .instr(Op::DO_START)
      .instr(Op::DO_END)
      .instr(Op::PUSH_CONST_VAL, 1)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  FiringContext fixture;
  fixture.ctx.setRuleFiringState(kRuleFuncId, RuleFiringState::DidFire);
  Machine machine;
  REQUIRE(startExecution(machine.state, image, kRuleFuncId, {}).isOk());
  machine.state.budget = 3;
  const RunResult result = runExecution(machine.state, image, fixture.surface);
  REQUIRE(result.status == RunStatus::Yielded);
  CHECK(fixture.ctx.ruleFiringState(kRuleFuncId) == RuleFiringState::Evaluating);
}

TEST_CASE("a rule with no WHEN boundary opcodes leaves its record at the initial value") {
  ProgramBuilder b;
  b.valueNil();
  b.ruleFunc(kRuleFuncId);
  b.beginFunction()
      .instr(Op::DO_START)
      .instr(Op::DO_END)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  FiringContext fixture;
  Machine machine;
  const RunResult result = runProgram(machine, image, {}, 1000, fixture.surface);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.tag() == ValueTag::Nil);
  CHECK(fixture.ctx.ruleFiringState(kRuleFuncId) == RuleFiringState::DidFire);
}

TEST_CASE("a WHEN in a function that is not a rule entry writes no record") {
  ProgramBuilder b;
  b.valueBool(false).valueNil();
  appendGatedRule(b, Op::WHEN_END, 0, 1);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  FiringContext fixture;
  Machine machine;
  const RunResult result = runProgram(machine, image, {}, 1000, fixture.surface);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(fixture.ctx.ruleFiringState(kRuleFuncId) == RuleFiringState::DidFire);
}
