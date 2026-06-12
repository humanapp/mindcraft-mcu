#pragma once

#include <cstdint>
#include <type_traits>

#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Per-fiber operand-stack capacity in values. Mirrors `VmConfig.maxStackSize`
 * in external/mindcraft-lang/packages/core/src/runtime/vm-types.ts, sized for
 * the device profile.
 */
inline constexpr uint32_t kMaxStackSize = 256;

/**
 * Per-fiber locals-region capacity in values: the summed `numLocals` of every
 * live frame. Exceeding it faults with `ErrorCode::StackOverflow`.
 */
inline constexpr uint32_t kMaxLocalsSize = 256;

/**
 * Per-fiber call-frame depth cap. Mirrors `VmConfig.maxFrameDepth`, sized for
 * the device profile.
 */
inline constexpr uint32_t kMaxFrameDepth = 64;

/**
 * Per-fiber try-handler depth cap. Mirrors `VmConfig.maxHandlers`, sized for
 * the device profile. No handler stack exists yet; the constant is the sizing
 * input for the exception-handling opcodes when they land.
 */
inline constexpr uint32_t kMaxHandlers = 16;

/**
 * Pending async-handle cap. Mirrors the `HandleTable` capacity in
 * external/mindcraft-lang/packages/core/src/runtime/vm-types.ts. Zero: the
 * device registers no async capabilities, so no handle may ever be created.
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
 * bookkeeping, and action-dispatch opcodes; nothing reads them yet.
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
 * One VM execution thread's complete runtime state: the operand stack, the
 * frame stack, the frame-locals region, and the instruction budget. Each
 * region is referenced by a base pointer plus a slot capacity; the state
 * never owns storage. Suspension (budget exhaustion) preserves every live
 * range, so a suspended state resumes by re-arming {@link budget} and
 * re-entering the dispatch loop.
 */
struct ExecutionState {
  /** Operand-stack region base. */
  Value* stack;
  /** Operand-stack capacity in slots; growing past it faults `StackOverflow`. */
  uint32_t stackLimit;
  /** Live operand count; the top of stack is `stack[stackDepth - 1]`. */
  uint32_t stackDepth;

  /** Locals-region base; frames hold contiguous slot runs in push order. */
  Value* locals;
  /** Locals-region capacity in slots; exceeding it faults `StackOverflow`. */
  uint32_t localsLimit;
  /** Live local-slot count across all frames. */
  uint32_t localsDepth;

  /** Frame-stack region base. */
  Frame* frames;
  /** Frame-stack capacity; pushing past it faults `StackOverflow`. */
  uint32_t frameLimit;
  /** Live frame count; the current frame is `frames[frameDepth - 1]`. */
  uint32_t frameDepth;

  /**
   * Remaining instruction budget. Each dispatched instruction consumes one
   * unit; the dispatch loop requires a positive budget at entry and suspends
   * cleanly at the first instruction boundary where it reaches zero.
   */
  int32_t budget;
};

static_assert(std::is_trivially_copyable_v<Frame>, "execution state stays trivially copyable");
static_assert(std::is_trivially_copyable_v<ExecutionState>,
              "execution state stays trivially copyable");

} // namespace mindcraft
