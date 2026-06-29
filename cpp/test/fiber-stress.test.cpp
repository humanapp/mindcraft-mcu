#include "doctest/doctest.h"

#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/fiber-scheduler.h"
#include "core/runtime/host-action.h"
#include "core/runtime/value.h"
#include "core/runtime/vm-observer.h"
#include "vm-harness.h"

#include <array>
#include <cstdint>
#include <vector>

using mindcraft::AsyncHandle;
using mindcraft::BrainRuntime;
using mindcraft::ErrorCode;
using mindcraft::ExecutionContext;
using mindcraft::FiberScheduler;
using mindcraft::HostActionBinding;
using mindcraft::Op;
using mindcraft::ProgramImage;
using mindcraft::RegionArena;
using mindcraft::Span;
using mindcraft::Status;
using mindcraft::Value;
using mindcraft::VmObserver;

namespace {

/** Number of independent nested-async root subtrees on the work page. */
constexpr uint32_t kWorkRoots = 4;

/**
 * Records each in-flight async handle and settles it a controlled number of
 * thinks later, so child rules park awaiting and resume with lingering,
 * out-of-order completion. Capacity bounds concurrent pending handles to the
 * profile's `maxHandles`.
 */
struct SettleQueue {
  struct Entry {
    AsyncHandle handle;
    uint32_t targetTick;
    bool active;
  };
  std::array<Entry, 16> entries{};

  void schedule(AsyncHandle handle, uint32_t targetTick) {
    for (Entry& e : entries) {
      if (!e.active) {
        e = Entry{handle, targetTick, true};
        return;
      }
    }
  }

  void pump(uint32_t now) {
    for (Entry& e : entries) {
      if (e.active && now >= e.targetTick) {
        e.handle.resolve(Value::number(0));
        e.active = false;
      }
    }
  }
};

/**
 * Shared host-action env: the scheduler (to sample the live-fiber occupancy at a
 * spawn boundary), the brain (to restart mid-round), the async settle queue, and
 * the test-armed restart gate plus the observed peak occupancy.
 */
struct StressEnv {
  FiberScheduler* scheduler = nullptr;
  BrainRuntime* brain = nullptr;
  SettleQueue settle;
  bool restartArmed = false;
  uint32_t peakLive = 0;

  void sampleLive() {
    const uint32_t live = scheduler->liveCount();
    if (live > peakLive) {
      peakLive = live;
    }
  }
};

/** Async host action: schedule its handle to settle `args[0]` thinks later. */
Status execAsyncWork(void* hostData, ExecutionContext& ctx, Span<const Value> args,
                     AsyncHandle handle) {
  StressEnv& env = *static_cast<StressEnv*>(hostData);
  const uint32_t delay =
      !args.empty() && args[0].isNumber() ? static_cast<uint32_t>(args[0].asNumber()) : 1;
  env.settle.schedule(handle, static_cast<uint32_t>(ctx.currentTick) + delay);
  env.sampleLive();
  return Status::ok();
}

/** Sync host action that restarts the active page mid-round when armed. */
Value execMaybeRestart(void* hostData, ExecutionContext&, Span<const Value>) {
  StressEnv& env = *static_cast<StressEnv*>(hostData);
  env.sampleLive();
  if (env.restartArmed) {
    env.restartArmed = false;
    env.brain->requestPageRestart();
  }
  return mindcraft::kVoidValue;
}

/** Records fiber faults so the stress run can assert none occurred. */
struct FaultObserver : VmObserver {
  uint32_t faults = 0;
  void onHostActionCall(uint32_t, uint32_t, Span<const Value>, const Value&) override {}
  void onFiberFault(uint32_t, ErrorCode) override { faults++; }
};

constexpr uint32_t kAsyncActionId = 5000;
constexpr uint32_t kRestartActionId = 5001;

/**
 * Builds the two-page stress program. Page 0 holds `kWorkRoots` root rules, each
 * a root -> child -> grandchild chain ending in an async actuator the grandchild
 * awaits (a different settle delay per root), plus a switcher root that restarts
 * the page when armed (it runs last, after the work roots have spawned this
 * round, so it samples the round's peak occupancy). Page 1 is a single idle
 * root, a quiescent target for page switches.
 */
ProgramImage buildStressProgram(ProgramBuilder& b, std::vector<uint8_t>& storage) {
  b.poolString("stress-page-0"); // string 0
  b.poolString("stress-page-1"); // string 1
  b.valueNil();                  // value 0 (each function's RET value)
  b.number(0);                   // number 0
  b.number(1);                   // number 1 (settle delays)
  b.number(2);                   // number 2
  b.number(3);                   // number 3

  for (uint32_t i = 0; i < kWorkRoots; i++) {
    const uint32_t childF = i * 3 + 1;
    const uint32_t grandchildF = i * 3 + 2;
    const uint32_t delayNum = (i % 3) + 1; // number index 1, 2, 3
    const uint32_t asyncCallSite = 100 + i;
    // root: spawn child, return.
    b.beginFunction()
        .instr(Op::SPAWN_RULE, static_cast<int32_t>(childF))
        .instr(Op::PUSH_CONST_VAL, 0)
        .instr(Op::RET);
    // child: spawn grandchild, return.
    b.beginFunction()
        .instr(Op::SPAWN_RULE, static_cast<int32_t>(grandchildF))
        .instr(Op::PUSH_CONST_VAL, 0)
        .instr(Op::RET);
    // grandchild: dispatch the async actuator with this root's delay, await it.
    b.beginFunction()
        .instr(Op::PUSH_CONST_NUM, static_cast<int32_t>(delayNum))
        .instr(Op::HOST_ACTION_CALL_ASYNC, static_cast<int32_t>(kAsyncActionId), 1,
               static_cast<int32_t>(asyncCallSite))
        .instr(Op::AWAIT)
        .instr(Op::POP)
        .instr(Op::PUSH_CONST_VAL, 0)
        .instr(Op::RET);
  }

  const uint32_t switcherF = kWorkRoots * 3;
  const uint32_t idleF = switcherF + 1;
  // switcher: call the restart action (a no-op until the test arms the gate).
  b.beginFunction()
      .instr(Op::HOST_ACTION_CALL, static_cast<int32_t>(kRestartActionId), 0, 200)
      .instr(Op::RET);
  // idle (page 1): return immediately.
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);

  for (uint32_t f = 0; f <= idleF; f++) {
    b.ruleFunc(f);
  }

  b.beginPage(0);
  for (uint32_t i = 0; i < kWorkRoots; i++) {
    b.pageRoot(i * 3);
  }
  b.pageRoot(switcherF);
  for (uint32_t i = 0; i < kWorkRoots; i++) {
    b.pageHostCallSite(100 + i, kAsyncActionId);
  }
  b.pageHostCallSite(200, kRestartActionId);

  b.beginPage(1);
  b.pageRoot(idleF);

  return b.build(storage);
}

} // namespace

TEST_CASE("sustained nested-async spawning with mid-round cancels stays leak-bounded") {
  ProgramBuilder builder;
  std::vector<uint8_t> imageStorage(8 * 1024);
  const ProgramImage image = buildStressProgram(builder, imageStorage);

  // A generous runtime arena: large enough that a non-leaking workload never
  // exhausts it, so unbounded growth (a leak) is the only way to run it dry.
  std::vector<uint8_t> arenaStorage(48 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));

  StressEnv env;
  HostActionBinding bindings[2] = {
      {kAsyncActionId, nullptr, nullptr, &env, &execAsyncWork},
      {kRestartActionId, &execMaybeRestart, nullptr, &env, nullptr},
  };

  ExecutionContext ctx;
  FaultObserver observer;
  mindcraft::RuntimeSurface surface{&ctx, {bindings, 2}, &observer};
  FiberScheduler scheduler(image, surface, arena, mindcraft::test::kDeviceProfileCaps);
  BrainRuntime brain(image, scheduler, surface);
  env.scheduler = &scheduler;
  env.brain = &brain;
  REQUIRE(brain.startup().isOk());

  constexpr uint32_t kThinks = 6000;
  constexpr uint32_t kWarmup = 1500;
  // Restart (mid-round cancel) and page-switch periods are small and coprime, so
  // cancels land while subtrees are spawned, parked, and resuming, in every
  // phase relationship.
  constexpr uint32_t kRestartPeriod = 13;
  constexpr uint32_t kSwitchPeriod = 17;

  size_t warmupHighWater = 0;
  uint32_t currentPage = 0;

  for (uint32_t t = 1; t <= kThinks; t++) {
    env.settle.pump(t);
    if (t % kRestartPeriod == 0) {
      env.restartArmed = true;
    }
    if (t % kSwitchPeriod == 0) {
      currentPage ^= 1u;
      brain.requestPageChange(currentPage);
    }

    REQUIRE(brain.think(static_cast<float>(t) * 16.0f).isOk());
    REQUIRE(observer.faults == 0);

    if (t <= kWarmup) {
      if (arena.bytesUsed() > warmupHighWater) {
        warmupHighWater = arena.bytesUsed();
      }
    } else {
      // After warmup the pools and slab free lists cover the peak working set,
      // so a non-leaking run never carves more arena. Any growth past the warmup
      // high-water is an unrecycled allocation.
      CHECK(arena.bytesUsed() <= warmupHighWater);
    }
  }

  // The lazy spawn model bounds the peak occupancy well under the fiber guard,
  // and the runtime working set is a small fraction of the 32 KiB device VM
  // region.
  CHECK(env.peakLive < mindcraft::test::kDeviceProfileCaps.maxFibers);
  CHECK(warmupHighWater < 32u * 1024u);
  CHECK(env.peakLive >= kWorkRoots); // the nested subtrees actually ran concurrently

  INFO("peak live fibers: " << env.peakLive);
  INFO("runtime arena high-water bytes: " << warmupHighWater);
}
