/**
 * The `otherwise` sensor: preceding-sibling derivation over the loaded program's
 * rule structure, and the read rule over the subject's firing record. Mirrors
 * `otherwise-sensor.spec.ts` in
 * external/wendoo-lang/packages/core/src/brain.
 *
 * The budget cases at the end run a real two-rule page on a {@link BrainRuntime}
 * whose per-slice budget splits the subject's WHEN across two thinks.
 *
 * The rule tree below is the document order the compiler's pre-order funcId walk
 * produces, so funcId comparison recovers sibling order:
 *
 *   page 0: rule 0
 *             rule 1
 *               rule 2
 *               rule 3
 *             rule 4
 *           rule 5
 *             rule 6
 *   page 1: rule 7
 *           rule 8
 */

#include "doctest/doctest.h"

#include "core/platform/span.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/bytecode.h"
#include "core/runtime/core-host-actions.h"
#include "core/runtime/device-profile-caps.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/host-action.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/host-actions/sensors/otherwise.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm-observer.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <vector>

using wendoo::BrainRuntime;
using wendoo::CoreHostActionEnv;
using wendoo::DeviceProfileCaps;
using wendoo::ErrorCode;
using wendoo::execOtherwise;
using wendoo::ExecutionContext;
using wendoo::FiberScheduler;
using wendoo::HostActionBinding;
using wendoo::kNoFuncId;
using wendoo::kVoidValue;
using wendoo::Op;
using wendoo::PageMetadata;
using wendoo::precedingSiblingRuleFuncId;
using wendoo::ProgramImage;
using wendoo::RegionArena;
using wendoo::RuleAncestor;
using wendoo::RuleFiringState;
using wendoo::RuntimeSurface;
using wendoo::Span;
using wendoo::Value;
using wendoo::VmObserver;

namespace CoreHostActions = wendoo::CoreHostActions;

namespace {

/** Rule-to-parent edges of the tree in this file's header comment. */
constexpr std::array<RuleAncestor, 4> kAncestors{{{1, 0}, {2, 1}, {3, 1}, {4, 0}}};

/** Root-rule funcId runs of both pages, back to back. */
constexpr std::array<uint32_t, 4> kRoots{{0, 5, 7, 8}};

/** Page metadata indexing into {@link kRoots}. */
constexpr std::array<PageMetadata, 2> kPages{{{0, 0, 0, 2, 0, 0}, {1, 0, 2, 2, 0, 0}}};

/** A read-only image carrying only the rule structure the sensor reads. */
ProgramImage makeRuleStructureImage() {
  ProgramImage image{};
  image.hasRuleAncestors = true;
  image.ruleAncestors = Span<const RuleAncestor>(kAncestors.data(), kAncestors.size());
  image.rootRuleFuncIds = Span<const uint32_t>(kRoots.data(), kRoots.size());
  image.pages = Span<const PageMetadata>(kPages.data(), kPages.size());
  return image;
}

/** Records for every rule funcId in the fixture tree, plus headroom. */
constexpr uint32_t kRuleFiringCount = 12;

/** An execution context whose firing records are bound over its own arena. */
struct FiringContext {
  FiringContext() : arena(Span<uint8_t>(storage.data(), storage.size())) {
    REQUIRE(ctx.bindSlots(arena, 0, 0, 0, 0, kRuleFiringCount));
  }

  std::array<uint8_t, 256> storage;
  RegionArena arena;
  ExecutionContext ctx;
};

/** Runs the sensor body for `ruleFuncId` against `image` and `ctx`. */
bool readOtherwise(const ProgramImage& image, ExecutionContext& ctx, uint32_t ruleFuncId) {
  CoreHostActionEnv env;
  env.program = &image;
  ctx.currentRuleFuncId = ruleFuncId;
  const Value result = execOtherwise(&env, ctx, Span<const Value>{});
  REQUIRE(result.isBoolean());
  return result.asBoolean();
}

/** Host-action ids of the two marker actuators the split-WHEN pair dispatches. */
constexpr uint32_t kSubjectMarkerActionId = 101;
constexpr uint32_t kComplementMarkerActionId = 102;

/**
 * Instruction budget per fiber slice for the split-WHEN runs. The subject rule
 * below runs 29 instructions, so 20 stops its WHEN mid-evaluation on the first
 * slice and completes it on the second, while the `otherwise` rule's own 9
 * instructions always fit in one slice.
 */
constexpr int32_t kSplitSliceBudget = 20;

/** Returns `caps` with its per-slice instruction budget set to `budget`. */
constexpr DeviceProfileCaps withDefaultBudget(DeviceProfileCaps caps, int32_t budget) {
  caps.defaultBudget = budget;
  return caps;
}

/** Actuator body recording the tick it ran on into the tick vector at `hostData`. */
Value execTickMarker(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(args);
  static_cast<std::vector<uint32_t>*>(hostData)->push_back(ctx.currentTick);
  return kVoidValue;
}

/** One evaluation of the `otherwise` sensor and the subject record it read. */
struct OtherwiseRead {
  uint32_t tick;
  RuleFiringState subjectRecord;
  bool fired;
};

/** Records every `otherwise` dispatch, plus any fiber fault, during a run. */
struct OtherwiseObserver : VmObserver {
  ExecutionContext* ctx = nullptr;
  uint32_t subjectFuncId = 0;
  std::vector<OtherwiseRead> reads;
  std::vector<ErrorCode> faults;

  void onHostActionCall(uint32_t actionId, uint32_t, Span<const Value>,
                        const Value& result) override {
    if (actionId != CoreHostActions::Otherwise.actionId) {
      return;
    }
    reads.push_back({ctx->currentTick, ctx->ruleFiringState(subjectFuncId), result.asBoolean()});
  }

  void onFiberFault(uint32_t, ErrorCode code) override { faults.push_back(code); }
};

/** One shared region with room for the pair's rule fibers and their execution regions. */
struct SchedulerStorage {
  static constexpr size_t kArenaBytes = 8 * (2048 + sizeof(wendoo::FiberRecord) + 64) + 256;
  std::array<uint8_t, kArenaBytes> bytes;
  RegionArena arena{Span<uint8_t>(bytes.data(), bytes.size())};
};

/**
 * A one-page program with two root rules. Rule 0's WHEN runs a long push/pop
 * stretch before gating on `subjectWhenValue`; rule 1's WHEN is the `otherwise`
 * sensor. Each rule's DO dispatches its own marker action.
 */
ProgramImage buildSplitWhenPair(ProgramBuilder& b, bool subjectWhenValue,
                                std::vector<uint8_t>& storage) {
  b.poolString("page-id");
  b.valueBool(subjectWhenValue).valueNil();

  // pc 0 WHEN_START, 1..20 the push/pop stretch, 21 the WHEN value, 22 the gate
  // (jumping to the end label at 27), 23..26 the DO section, 27..28 the return.
  b.beginFunction().instr(Op::WHEN_START);
  for (uint32_t i = 0; i < 10; i++) {
    b.instr(Op::PUSH_CONST_VAL, 0).instr(Op::POP);
  }
  b.instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::WHEN_END, 5)
      .instr(Op::DO_START)
      .instr(Op::HOST_ACTION_CALL, static_cast<int32_t>(kSubjectMarkerActionId), 0, 0)
      .instr(Op::DO_END)
      .instr(Op::JMP, 1)
      .instr(Op::PUSH_CONST_VAL, 1)
      .instr(Op::RET);

  b.beginFunction()
      .instr(Op::WHEN_START)
      .instr(Op::HOST_ACTION_CALL, static_cast<int32_t>(CoreHostActions::Otherwise.actionId), 0, 1)
      .instr(Op::WHEN_END, 5)
      .instr(Op::DO_START)
      .instr(Op::HOST_ACTION_CALL, static_cast<int32_t>(kComplementMarkerActionId), 0, 2)
      .instr(Op::DO_END)
      .instr(Op::JMP, 1)
      .instr(Op::PUSH_CONST_VAL, 1)
      .instr(Op::RET);

  b.ruleFunc(0).ruleFunc(1);
  b.beginPage(0)
      .pageRoot(0)
      .pageRoot(1)
      .pageHostCallSite(0, kSubjectMarkerActionId)
      .pageHostCallSite(1, CoreHostActions::Otherwise.actionId)
      .pageHostCallSite(2, kComplementMarkerActionId);
  return b.build(storage);
}

/** What one {@link runSplitWhenPair} run observed. */
struct SplitWhenRun {
  /** Ticks the subject rule's DO side ran on. */
  std::vector<uint32_t> subjectTicks;
  /** Ticks the `otherwise` rule's DO side ran on. */
  std::vector<uint32_t> complementTicks;
  /** Every evaluation of the `otherwise` sensor, in order. */
  std::vector<OtherwiseRead> otherwiseReads;
  /** Fault codes raised during the run; a healthy run raises none. */
  std::vector<ErrorCode> faults;
};

/**
 * Runs `ticks` thinks of {@link buildSplitWhenPair} at
 * {@link kSplitSliceBudget}, so the subject's WHEN splits across two slices.
 */
SplitWhenRun runSplitWhenPair(bool subjectWhenValue, uint32_t ticks) {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = buildSplitWhenPair(b, subjectWhenValue, storage);

  ExecutionContext ctx;
  CoreHostActionEnv env;
  env.program = &image;
  SplitWhenRun run;
  const HostActionBinding bindings[3] = {
      {CoreHostActions::Otherwise.actionId, &execOtherwise, nullptr, &env},
      {kSubjectMarkerActionId, &execTickMarker, nullptr, &run.subjectTicks},
      {kComplementMarkerActionId, &execTickMarker, nullptr, &run.complementTicks},
  };

  OtherwiseObserver observer;
  observer.ctx = &ctx;
  observer.subjectFuncId = 0;
  RuntimeSurface surface{&ctx, {bindings, 3}, &observer};
  SchedulerStorage pools;
  FiberScheduler scheduler(image, surface, pools.arena,
                           withDefaultBudget(wendoo::test::kDeviceProfileCaps, kSplitSliceBudget));
  BrainRuntime brain(image, scheduler, surface);
  REQUIRE(brain.startup().isOk());
  for (uint32_t i = 1; i <= ticks; i++) {
    REQUIRE(brain.think(16.0f * static_cast<float>(i)).isOk());
  }

  run.otherwiseReads = observer.reads;
  run.faults = observer.faults;
  return run;
}

} // namespace

TEST_CASE("a root rule's subject is its predecessor in its own page's root run") {
  const ProgramImage image = makeRuleStructureImage();
  CHECK(precedingSiblingRuleFuncId(image, 0) == kNoFuncId);
  CHECK(precedingSiblingRuleFuncId(image, 5) == 0);
  CHECK(precedingSiblingRuleFuncId(image, 7) == kNoFuncId);
  CHECK(precedingSiblingRuleFuncId(image, 8) == 7);
}

TEST_CASE("a child rule's subject is the preceding rule under the same parent") {
  const ProgramImage image = makeRuleStructureImage();
  CHECK(precedingSiblingRuleFuncId(image, 1) == kNoFuncId);
  CHECK(precedingSiblingRuleFuncId(image, 4) == 1);
  CHECK(precedingSiblingRuleFuncId(image, 2) == kNoFuncId);
  CHECK(precedingSiblingRuleFuncId(image, 3) == 2);
}

TEST_CASE("a grandchild is never mistaken for a preceding sibling") {
  // Rule 4's siblings under parent 0 are rules 1 and 4; rules 2 and 3 sit under
  // rule 1 and carry funcIds between them, so only the parent match excludes
  // them.
  const ProgramImage image = makeRuleStructureImage();
  CHECK(precedingSiblingRuleFuncId(image, 4) == 1);
}

TEST_CASE("a rule outside the program's structure has no subject") {
  const ProgramImage image = makeRuleStructureImage();
  CHECK(precedingSiblingRuleFuncId(image, kNoFuncId) == kNoFuncId);
  CHECK(precedingSiblingRuleFuncId(image, 99) == kNoFuncId);
}

TEST_CASE("the sensor fires only when its subject did not fire") {
  const ProgramImage image = makeRuleStructureImage();
  FiringContext fixture;

  fixture.ctx.setRuleFiringState(0, RuleFiringState::DidNotFire);
  CHECK(readOtherwise(image, fixture.ctx, 5));

  fixture.ctx.setRuleFiringState(0, RuleFiringState::DidFire);
  CHECK_FALSE(readOtherwise(image, fixture.ctx, 5));

  fixture.ctx.setRuleFiringState(0, RuleFiringState::Evaluating);
  CHECK_FALSE(readOtherwise(image, fixture.ctx, 5));
}

TEST_CASE("the sensor reads its own level, not an outer one") {
  const ProgramImage image = makeRuleStructureImage();
  FiringContext fixture;

  // Rule 4's subject is rule 1, not the root rule 0 above its parent.
  fixture.ctx.setRuleFiringState(0, RuleFiringState::DidNotFire);
  fixture.ctx.setRuleFiringState(1, RuleFiringState::DidFire);
  CHECK_FALSE(readOtherwise(image, fixture.ctx, 4));

  fixture.ctx.setRuleFiringState(1, RuleFiringState::DidNotFire);
  CHECK(readOtherwise(image, fixture.ctx, 4));
}

TEST_CASE("a rule that never wrote a record reads as fired, so the sensor stays quiet") {
  const ProgramImage image = makeRuleStructureImage();
  FiringContext fixture;
  CHECK_FALSE(readOtherwise(image, fixture.ctx, 5));
}

TEST_CASE("the first rule at its level and a dispatch outside any rule both read false") {
  const ProgramImage image = makeRuleStructureImage();
  FiringContext fixture;
  CHECK_FALSE(readOtherwise(image, fixture.ctx, 0));
  CHECK_FALSE(readOtherwise(image, fixture.ctx, kNoFuncId));
}

TEST_CASE("the otherwise rule evaluates and stays quiet on the think its subject's WHEN splits") {
  const SplitWhenRun run = runSplitWhenPair(true, 4);

  CHECK(run.faults.empty());
  REQUIRE(run.otherwiseReads.size() == 4);
  const std::array<uint32_t, 4> expectedTicks{{1, 2, 3, 4}};
  const std::array<RuleFiringState, 4> expectedRecords{
      {RuleFiringState::Evaluating, RuleFiringState::DidFire, RuleFiringState::Evaluating,
       RuleFiringState::DidFire}};
  for (size_t i = 0; i < run.otherwiseReads.size(); i++) {
    CHECK(run.otherwiseReads[i].tick == expectedTicks[i]);
    CHECK(run.otherwiseReads[i].subjectRecord == expectedRecords[i]);
    CHECK_FALSE(run.otherwiseReads[i].fired);
  }

  const std::vector<uint32_t> gateLandings{2, 4};
  CHECK(run.subjectTicks == gateLandings);
  CHECK(run.complementTicks.empty());
}

TEST_CASE("the otherwise rule fires on the think a split subject's gate lands not-fired") {
  const SplitWhenRun run = runSplitWhenPair(false, 4);

  CHECK(run.faults.empty());
  REQUIRE(run.otherwiseReads.size() == 4);
  const std::array<uint32_t, 4> expectedTicks{{1, 2, 3, 4}};
  const std::array<RuleFiringState, 4> expectedRecords{
      {RuleFiringState::Evaluating, RuleFiringState::DidNotFire, RuleFiringState::Evaluating,
       RuleFiringState::DidNotFire}};
  const std::array<bool, 4> expectedFired{{false, true, false, true}};
  for (size_t i = 0; i < run.otherwiseReads.size(); i++) {
    CHECK(run.otherwiseReads[i].tick == expectedTicks[i]);
    CHECK(run.otherwiseReads[i].subjectRecord == expectedRecords[i]);
    CHECK(run.otherwiseReads[i].fired == expectedFired[i]);
  }

  const std::vector<uint32_t> gateLandings{2, 4};
  CHECK(run.subjectTicks.empty());
  CHECK(run.complementTicks == gateLandings);
}

TEST_CASE("the sensor reads false without a bound program") {
  FiringContext fixture;
  CoreHostActionEnv env;
  fixture.ctx.currentRuleFuncId = 5;
  const Value result = execOtherwise(&env, fixture.ctx, Span<const Value>{});
  REQUIRE(result.isBoolean());
  CHECK_FALSE(result.asBoolean());
}
