#pragma once

#include <cstdint>
#include <type_traits>

#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace mindcraft {

class StackRegionAllocator;

/**
 * Per-fiber operand-stack depth cap in values. A push past it faults
 * `ErrorCode::StackOverflow`; the region grows on demand toward this cap.
 */
inline constexpr uint32_t kMaxStackSize = 256;

/**
 * Per-fiber locals-region depth cap in values: the summed `numLocals` of every
 * live frame. Exceeding it faults `ErrorCode::StackOverflow`; the region grows
 * on demand toward this cap.
 */
inline constexpr uint32_t kMaxLocalsSize = 256;

/**
 * Per-fiber call-frame depth cap. A push past it faults
 * `ErrorCode::StackOverflow`; the region grows on demand toward this cap.
 */
inline constexpr uint32_t kMaxFrameDepth = 64;

/**
 * Per-fiber try-handler depth cap. A push past it faults
 * `ErrorCode::StackOverflow`; the handler stack grows on demand toward this cap.
 */
inline constexpr uint32_t kMaxHandlers = 16;

/**
 * Pending async-handle cap. Zero until async handles are implemented: no handle
 * may be created and any async opcode faults.
 */
inline constexpr uint32_t kMaxHandles = 0;

/**
 * Per-frame binding describing the action call and call site whose state
 * slots back the frame. Mirrors `ActionFrameBinding` in
 * external/mindcraft-lang/packages/core/src/runtime/vm-types.ts with the
 * action identified by stable id.
 */
struct ActionFrameBinding {
  /** Stable id of the bound action. */
  uint32_t actionId;
  /** Call-site id keying per-callsite state. */
  uint32_t callSiteId;
  /** True when the frame was entered through an async action call. */
  bool isAsync;
};

/**
 * Single call frame on an execution state's frame stack. Mirrors `Frame` in
 * external/mindcraft-lang/packages/core/src/runtime/vm-types.ts. `captures`,
 * `ruleFuncId`, and the action binding are carried for the closure, rule
 * bookkeeping, and action-dispatch opcodes.
 */
struct Frame {
  /** FuncId of the executing function. */
  uint32_t funcId;
  /** Index of the next instruction within the function's body. */
  uint32_t pc;
  /** Operand-stack depth at frame entry; `RET` truncates the stack to it. */
  uint32_t base;
  /** First slot of this frame's locals in the execution state's locals region. */
  uint32_t localsOffset;
  /** Number of local slots, including params. */
  uint32_t localsCount;
  /** Captures handle, or {@link kNoCaptures} when the frame has none. */
  uint32_t captures;
  /** FuncId of the owning rule, or {@link kNoFuncId} when none. */
  uint32_t ruleFuncId;
  /** True when {@link actionBinding} is meaningful. */
  bool hasActionBinding;
  /** The action call backing this frame. Meaningful only when {@link hasActionBinding}. */
  ActionFrameBinding actionBinding;
};

/**
 * One try-handler on a fiber's handler stack. Mirrors `Handler` in
 * external/mindcraft-lang/packages/core/src/runtime/vm-types.ts. A handler
 * carries only indices and a pc - no `Value`s - so the handler stack is never
 * a garbage-collection root.
 */
struct Handler {
  /** Frame depth at `TRY`; `THROW` truncates the frame stack to it. */
  uint32_t frameIndex;
  /** Operand-stack depth at `TRY`; `THROW` truncates the stack to it. */
  uint32_t stackHeight;
  /** Absolute pc within the catching frame's function `THROW` jumps to. */
  uint32_t catchTarget;
};

/**
 * One VM execution thread's complete runtime state: the operand stack, the
 * frame stack, the frame-locals region, the try-handler stack, and the
 * instruction budget. Each region is referenced by a base pointer plus a depth
 * cap (the `*Limit` guard) and a current allocated capacity (the `*Capacity`
 * that grows on demand toward the cap); the state never owns storage. A push
 * past the live capacity grows the region through {@link allocator} (when set);
 * a push past the cap faults `StackOverflow`. Suspension (budget exhaustion or
 * `YIELD`) preserves every live range, so a suspended state resumes by
 * re-arming {@link budget} and re-entering the dispatch loop.
 */
struct ExecutionState {
  /** Operand-stack region base. */
  Value* stack;
  /** Operand-stack depth cap; pushing past it faults `StackOverflow`. */
  uint32_t stackLimit;
  /** Allocated operand-stack capacity in slots; grows on demand toward the cap. */
  uint32_t stackCapacity;
  /** Live operand count; the top of stack is `stack[stackDepth - 1]`. */
  uint32_t stackDepth;

  /** Locals-region base; frames hold contiguous slot runs in push order. */
  Value* locals;
  /** Locals-region depth cap; exceeding it faults `StackOverflow`. */
  uint32_t localsLimit;
  /** Allocated locals capacity in slots; grows on demand toward the cap. */
  uint32_t localsCapacity;
  /** Live local-slot count across all frames. */
  uint32_t localsDepth;

  /** Frame-stack region base. */
  Frame* frames;
  /** Frame-stack depth cap; pushing past it faults `StackOverflow`. */
  uint32_t frameLimit;
  /** Allocated frame-stack capacity in slots; grows on demand toward the cap. */
  uint32_t frameCapacity;
  /** Live frame count; the current frame is `frames[frameDepth - 1]`. */
  uint32_t frameDepth;

  /** Try-handler stack base; grown on demand like the value regions. */
  Handler* handlers;
  /** Handler-stack depth cap; pushing past it faults `StackOverflow`. */
  uint32_t handlerLimit;
  /** Allocated handler capacity in slots; grows on demand toward the cap. */
  uint32_t handlerCapacity;
  /** Live handler count; the innermost handler is `handlers[handlerDepth - 1]`. */
  uint32_t handlerDepth;

  /**
   * Grow-on-demand backing allocator for the four regions, or null when the
   * regions are fixed (pre-allocated to their capacity, as in standalone test
   * states). A grow re-derives the region base, so never cache a base across a
   * push that can grow. The allocator must outlive every state that points at
   * it.
   */
  StackRegionAllocator* allocator;

  /**
   * Remaining instruction budget. Each dispatched instruction consumes one
   * unit; the dispatch loop requires a positive budget at entry and suspends
   * cleanly at the first instruction boundary where it reaches zero.
   */
  int32_t budget;

  /**
   * Set when the running fiber is cancelled mid-slice (a host body requested a
   * page change or restart). The dispatch loop checks it at each instruction
   * boundary and stops the slice, abandoning the rest of the current body.
   */
  bool cancelled = false;
};

static_assert(std::is_trivially_copyable_v<Frame>, "execution state stays trivially copyable");
static_assert(std::is_trivially_copyable_v<Handler>, "execution state stays trivially copyable");
static_assert(std::is_trivially_copyable_v<ExecutionState>,
              "execution state stays trivially copyable");

} // namespace mindcraft
