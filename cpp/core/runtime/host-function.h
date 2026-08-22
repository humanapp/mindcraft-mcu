#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"

namespace wendoo {

/**
 * A target host-function body: services one `HOST_CALL` whose funcId is at or
 * above {@link TARGET_FUNC_ID_BASE}. `args` is an ephemeral view of the
 * positional arg buffer (argc slots, arg0 first; a missing optional slot is
 * nil) valid only for the duration of the call; `hostData` is the pointer the
 * function was registered with. On success the body writes the pushed-back
 * value to `result` and returns ok; a non-ok status faults the call. Target
 * host functions take no execution context, mirroring the core host-function
 * convention.
 */
using TargetHostFuncExec = Status (*)(void* hostData, Span<const Value> args, Value& result);

/**
 * An asynchronous target host-function body: services one `HOST_CALL_ASYNC`
 * whose funcId is at or above {@link TARGET_FUNC_ID_BASE}. `ctx` is the brain
 * execution context (its `time` is the dispatch tick time); `args` is an owned
 * snapshot of the positional arg buffer valid only for the duration of the
 * call; `handle` is the bound settle handle the call owns. The body must arrange
 * for that handle to eventually resolve, reject, or cancel. A non-ok status
 * faults the dispatching call (the opcode frees the handle first). `hostData`
 * is the pointer the function was registered with.
 */
using TargetHostFuncExecAsync = Status (*)(void* hostData, ExecutionContext& ctx,
                                           Span<const Value> args, AsyncHandle handle);

/**
 * One registered target host function: its stable funcId, the body, and the
 * opaque pointer passed back to the body. A function is either synchronous
 * ({@link exec} set, serviced by `HOST_CALL`) or asynchronous
 * ({@link execAsync} set, serviced by `HOST_CALL_ASYNC`); exactly one body is
 * non-null.
 */
struct TargetHostFuncBinding {
  /** Stable host-function id (the `HOST_CALL` operand), >= `TARGET_FUNC_ID_BASE`. */
  uint32_t funcId;

  /** Synchronous body, or null when the function is asynchronous. */
  TargetHostFuncExec exec;

  /** Opaque pointer handed to {@link exec} or {@link execAsync}. */
  void* hostData;

  /** Asynchronous body, or null when the function is synchronous. */
  TargetHostFuncExecAsync execAsync = nullptr;
};

/**
 * Returns the registration holding `funcId`, or nullptr when no entry of
 * `bindings` does.
 */
inline const TargetHostFuncBinding*
findTargetHostFuncById(Span<const TargetHostFuncBinding> bindings, uint32_t funcId) {
  for (size_t i = 0; i < bindings.size(); i++) {
    if (bindings[i].funcId == funcId) {
      return &bindings[i];
    }
  }
  return nullptr;
}

} // namespace wendoo
