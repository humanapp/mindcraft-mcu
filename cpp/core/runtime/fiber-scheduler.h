#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-state.h"
#include "core/runtime/pool.h"
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
 * Maximum number of concurrently live fibers, checked at spawn. Mirrors the
 * microbit-v2 profile's `maxFibers` (wodal `device-profile.ts`); the two values
 * must stay equal.
 */
inline constexpr uint32_t kMaxFibers = 100;

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
 * Backing storage for one fiber's execution: the operand stack, locals region,
 * and frame stack at the per-fiber caps. Drawn from a {@link Pool} at spawn and
 * released at reclaim; an {@link ExecutionState} points its three regions into
 * these arrays.
 */
struct FiberWorkspace {
  Value stack[kMaxStackSize];
  Value locals[kMaxLocalsSize];
  Frame frames[kMaxFrameDepth];
};

/**
 * One live fiber: its id, lifecycle state, execution state, and the workspace
 * its regions point into. Both the record and its workspace are drawn from the
 * scheduler's pools at spawn and released when the record is reclaimed.
 */
struct FiberRecord {
  /** Scheduler-assigned fiber id, unique for the scheduler's lifetime. */
  uint32_t id;
  FiberState state;
  ExecutionState exec;
  /** The workspace backing `exec`'s regions; released with the record. */
  FiberWorkspace* workspace;
  /** Next fiber in the run queue (intrusive FIFO), or nullptr at the tail. */
  FiberRecord* nextRunnable;
};

/**
 * Cooperative fiber scheduler with round-based ticks. A `tick()` is one
 * round: every fiber in the runnable queue at entry receives exactly one
 * {@link kDefaultBudget} slice in FIFO order, and anything enqueued while
 * the round runs joins the next round. A fiber's record and workspace are
 * drawn from pools over one shared {@link RegionArena}, and the run queue is
 * an intrusive FIFO threaded through the records; spawn faults
 * `ErrorCode::StackOverflow` at {@link kMaxFibers} or when the region is
 * exhausted. Mirrors `FiberScheduler` in
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
   * Fails with `ErrorCode::StackOverflow` when the live-fiber count is already
   * {@link kMaxFibers} or the region cannot back the fiber's record or
   * workspace, and with the {@link startExecution} code when the entry frame
   * cannot be pushed.
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
   * Reclaims finished fibers (`Done`/`Fault`/`Cancelled`): releases each one's
   * workspace and record back to the pools. Order is unconstrained - the pools
   * recycle slots independently, so a finished fiber is reclaimed regardless of
   * any still-live fiber.
   */
  void sweep();

  /** The record holding `fiberId`, or nullptr when none does. */
  const FiberRecord* fiber(uint32_t fiberId) const;

  /** Number of record slots currently in use. */
  uint32_t liveCount() const;

  /** The shared region backing this scheduler's pools. */
  RegionArena& arena() { return arena_; }

private:
  FiberRecord* findFiber(uint32_t fiberId);
  void enqueue(FiberRecord* record);
  FiberRecord* dequeue();
  void removeFromQueue(FiberRecord* record);

  const ProgramImage& program_;
  RuntimeSurface surface_;
  RegionArena& arena_;
  Pool<FiberRecord> records_;
  Pool<FiberWorkspace> workspaces_;
  // Intrusive FIFO run queue over the records. Each live fiber is enqueued at
  // most once (at spawn or on a budget re-enqueue after being dequeued).
  FiberRecord* runHead_ = nullptr;
  FiberRecord* runTail_ = nullptr;
  uint32_t queueCount_ = 0;
  uint32_t nextFiberId_ = 1;
};

} // namespace mindcraft
