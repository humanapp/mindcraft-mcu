#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/device-profile-caps.h"
#include "core/runtime/execution-state.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/pool.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/result.h"
#include "core/runtime/stack-region.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"

namespace mindcraft {

/**
 * Slot counts a freshly spawned fiber's four regions (operand stack, locals,
 * frames, handlers) start at before growing on demand toward their `kMax*`
 * caps. Each must be at least one slot.
 */
inline constexpr uint32_t kInitialStackSlots = 8;
inline constexpr uint32_t kInitialLocalsSlots = 4;
inline constexpr uint32_t kInitialFrameSlots = 2;
inline constexpr uint32_t kInitialHandlerSlots = 1;

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
 * One live fiber: its id, lifecycle state, and execution state. The four
 * execution regions are slab-backed blocks the scheduler reserves at spawn and
 * releases at reclaim; `exec` holds their bases and capacities directly (no
 * separate workspace), and grows them on demand through the shared
 * {@link StackRegionAllocator}.
 */
struct FiberRecord {
  /** Scheduler-assigned fiber id, unique for the scheduler's lifetime. */
  uint32_t id;
  FiberState state;
  ExecutionState exec;
  /** Next fiber in the run queue (intrusive FIFO), or nullptr at the tail. */
  FiberRecord* nextRunnable;
};

/**
 * Cooperative fiber scheduler with round-based ticks. A `tick()` is one
 * round: every fiber in the runnable queue at entry receives exactly one
 * {@link DeviceProfileCaps::defaultBudget} slice in FIFO order, and anything
 * enqueued while the round runs joins the next round. A fiber's record is drawn
 * from a pool and its execution regions are slab-backed blocks - both over one
 * shared {@link RegionArena} - and the run queue is an intrusive FIFO threaded
 * through the records; spawn faults `ErrorCode::StackOverflow` at
 * {@link DeviceProfileCaps::maxFibers} or when the region is exhausted. Mirrors
 * `FiberScheduler` in
 * external/mindcraft-lang/packages/core/src/runtime/vm.ts under the
 * round-tick semantics.
 *
 * Single-entry: only the host think loop may call {@link tick}; host
 * callbacks and action bodies must never re-enter it.
 *
 * The scheduler is also the managed heap's {@link GcRoots} source: it holds
 * every live fiber, so a collection enumerates all reachable values from the
 * fibers' operand stacks and locals plus the bound execution context's brain
 * variables and per-callsite state.
 */
class FiberScheduler : public GcRoots {
public:
  /**
   * A scheduler executing `program` against `surface` under `caps`. The caps
   * supply the per-round instruction budget and every per-fiber resource limit;
   * the target/host builds them from the device profile. Each fiber's four
   * execution regions start small (the `kInitial*Slots` counts) and grow on
   * demand toward the caps; their blocks, and the fiber records, are drawn from
   * `arena`. `arena` is the shared VM working-memory block - typically the same
   * one the program image was decoded into - and must outlive the scheduler.
   */
  FiberScheduler(const ProgramImage& program, const RuntimeSurface& surface, RegionArena& arena,
                 const DeviceProfileCaps& caps);

  /**
   * Spawns a runnable fiber executing `funcId` with no arguments and
   * enqueues it. The new fiber joins the round a subsequent `tick()` opens.
   * Fails with `ErrorCode::StackOverflow` when the live-fiber count is already
   * {@link DeviceProfileCaps::maxFibers} or the region cannot back the fiber's
   * record or initial execution regions, and with the {@link startExecution}
   * code when the entry frame cannot be pushed.
   */
  Result<uint32_t> spawn(uint32_t funcId);

  /**
   * Runs a page-lifecycle hook function to completion synchronously, outside
   * the round queue, as a sync bytecode action frame: the entry frame carries
   * an action binding ({@link actionId}, {@link callSiteId}, not async) so the
   * hook's `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` resolve and a `YIELD`
   * inside it faults. The hook gets one {@link DeviceProfileCaps::hookBudget} slice
   * and must finish in it. Returns ok when the hook completes; fails with the fault
   * code when it faults, and with `ErrorCode::ScriptError` when it cannot
   * finish in one slice (it suspended). Mirrors `runBytecodeHook` in
   * external/mindcraft-lang/packages/core/src/runtime/brain-runtime.ts.
   */
  Status runActionHook(uint32_t funcId, uint32_t actionId, uint32_t callSiteId);

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
   * four execution regions back to the region allocator and its record back to
   * the pool. A suspended (`Runnable` via `YIELD` or budget) fiber keeps its
   * regions across rounds; only a terminal fiber releases them. Order is
   * unconstrained - slots and blocks recycle independently.
   */
  void sweep();

  /** The record holding `fiberId`, or nullptr when none does. */
  const FiberRecord* fiber(uint32_t fiberId) const;

  /** Number of record slots currently in use. */
  uint32_t liveCount() const;

  /** The shared region backing this scheduler's pools. */
  RegionArena& arena() { return arena_; }

  /**
   * Marks every live garbage-collection root into `marker`: each live fiber's
   * operand stack and locals, plus the bound execution context's brain
   * variables and present per-callsite state. Implements {@link GcRoots}.
   */
  void enumerateRoots(GcMarker& marker) override;

private:
  // Reserves a fiber's record and four execution regions and pushes its entry
  // frame for `funcId`, without enqueuing it. Returns the record, or nullptr
  // with `err` set on a cap, region-exhaustion, or entry-frame failure. Shared
  // by spawn (which then enqueues) and the synchronous hook runner.
  FiberRecord* allocFiber(uint32_t funcId, ErrorCode& err);

  FiberRecord* findFiber(uint32_t fiberId);
  void enqueue(FiberRecord* record);
  FiberRecord* dequeue();
  void removeFromQueue(FiberRecord* record);

  // Releases all four execution regions of `exec` back to the region allocator.
  void releaseRegions(ExecutionState& exec);

  const ProgramImage& program_;
  RuntimeSurface surface_;
  RegionArena& arena_;
  DeviceProfileCaps caps_;
  Pool<FiberRecord> records_;
  // Grow-on-demand backing for every fiber's stack/locals/frame/handler regions.
  StackRegionAllocator regions_;
  // Intrusive FIFO run queue over the records. Each live fiber is enqueued at
  // most once (at spawn or on a budget re-enqueue after being dequeued).
  FiberRecord* runHead_ = nullptr;
  FiberRecord* runTail_ = nullptr;
  uint32_t queueCount_ = 0;
  uint32_t nextFiberId_ = 1;
};

} // namespace mindcraft
