#pragma once

#include <array>
#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-state.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"

namespace mindcraft {

/**
 * Instruction budget granted to each fiber's slice of a tick. Mirrors the
 * microbit-v2 profile's `defaultBudget` (wodal `device-profile.ts`); the two
 * values must stay equal.
 */
inline constexpr int32_t kDefaultBudget = 1000;

/**
 * Count cap on concurrently live fibers, checked at spawn. Sized for the
 * nRF52833's 128KB RAM together with the shared stack-region budgets.
 */
inline constexpr uint32_t kMaxLiveFibers = 8;

/** Sentinel fiber id; real ids start at 1. */
inline constexpr uint32_t kNoFiberId = 0;

/**
 * Lifecycle state of a fiber. Mirrors `FiberState` in
 * external/mindcraft-lang/packages/core/src/runtime/vm-types.ts.
 */
enum class FiberState : uint8_t {
  /** Eligible for a slice in a scheduler round. */
  Runnable,
  /** Blocked on a pending async handle. Unproduced until handles land. */
  Waiting,
  /** The fiber's function completed. */
  Done,
  /** The fiber faulted and must not be re-entered. */
  Fault,
  /** The fiber was cancelled by the host. */
  Cancelled,
};

/**
 * One live fiber: its id, lifecycle state, and execution state. The
 * execution state's stack/locals/frame segments are carved from the
 * scheduler's shared arena at spawn and released when the record is reclaimed.
 */
struct FiberRecord {
  /** True while the record holds a fiber (live or awaiting region reclaim). */
  bool inUse;
  /** Scheduler-assigned fiber id, unique for the scheduler's lifetime. */
  uint32_t id;
  FiberState state;
  ExecutionState exec;
  /** Arena high-water before this fiber's segments; reclaim releases to it. */
  RegionArena::Mark regionMark;
};

/**
 * Cooperative fiber scheduler with round-based ticks. A `tick()` is one
 * round: every fiber in the runnable queue at entry receives exactly one
 * {@link kDefaultBudget} slice in FIFO order, and anything enqueued while
 * the round runs joins the next round. Fiber records live in a fixed array
 * of {@link kMaxLiveFibers} slots (the count cap, a few hundred bytes); their
 * stack/locals/frame segments are carved on demand from one shared {@link
 * RegionArena} and released at reclaim, so a dormant slot costs no arena
 * bytes. Spawn faults loudly when no record slot or arena space is free.
 * Mirrors `FiberScheduler` in
 * external/mindcraft-lang/packages/core/src/runtime/vm.ts under the
 * round-tick semantics.
 *
 * Single-entry: only the host think loop may call {@link tick}; host
 * callbacks and action bodies must never re-enter it.
 */
class FiberScheduler {
public:
  /**
   * A scheduler executing `program` against `surface`, carving each fiber's
   * stack/locals/frame segments ({@link kMaxStackSize}, {@link kMaxLocalsSize},
   * and {@link kMaxFrameDepth} slots) from `arena` at spawn. `arena` is the
   * shared VM working-memory block - typically the same one the program image
   * was decoded into, so segments are carved above it - and must outlive the
   * scheduler.
   */
  FiberScheduler(const ProgramImage& program, const RuntimeSurface& surface, RegionArena& arena);

  /**
   * Spawns a runnable fiber executing `funcId` with no arguments and
   * enqueues it. The new fiber joins the round a subsequent `tick()` opens.
   * Fails with `ErrorCode::StackOverflow` when no record slot or region
   * storage is free, and with the {@link startExecution} code when the entry
   * frame cannot be pushed.
   */
  Result<uint32_t> spawn(uint32_t funcId);

  /** Cancels the fiber holding `fiberId`; a no-op when it is not live. */
  void cancel(uint32_t fiberId);

  /**
   * Runs one round: every fiber runnable at entry gets one budget slice in
   * FIFO order; fibers enqueued during the round (a spawn or a
   * budget-exhaustion re-enqueue) run in the next round. A slice ending in
   * `RunStatus::Waiting` is a host-contract violation (no async capability
   * exists) and faults the fiber with `ErrorCode::HostError`. Returns the
   * number of fibers that received a slice.
   */
  uint32_t tick();

  /**
   * Reclaims finished fibers (`Done`/`Fault`/`Cancelled`): releases their
   * stack regions and frees their record slots, in last-spawned-first order
   * down to the most recently spawned still-live fiber. A finished fiber
   * below a live one stays allocated until that fiber finishes.
   */
  void sweep();

  /** The record holding `fiberId`, or nullptr when none does. */
  const FiberRecord* fiber(uint32_t fiberId) const;

  /** Number of record slots currently in use. */
  uint32_t liveCount() const;

private:
  FiberRecord* findFiber(uint32_t fiberId);
  void enqueue(uint32_t fiberId);
  uint32_t dequeue();

  const ProgramImage& program_;
  RuntimeSurface surface_;
  RegionArena& arena_;
  std::array<FiberRecord, kMaxLiveFibers> records_{};
  // FIFO run queue. Each live fiber is enqueued at most once (at spawn or on
  // a budget re-enqueue after being dequeued), so kMaxLiveFibers bounds it.
  std::array<uint32_t, kMaxLiveFibers> queue_{};
  uint32_t queueHead_ = 0;
  uint32_t queueCount_ = 0;
  uint32_t nextFiberId_ = 1;
};

} // namespace mindcraft
