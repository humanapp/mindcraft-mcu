#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"

namespace mindcraft {

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
 * One registered target host function: its stable funcId, the body, and the
 * opaque pointer passed back to the body.
 */
struct TargetHostFuncBinding {
  /** Stable host-function id (the `HOST_CALL` operand), >= `TARGET_FUNC_ID_BASE`. */
  uint32_t funcId;

  /** Body. Must be non-null. */
  TargetHostFuncExec exec;

  /** Opaque pointer handed to {@link exec}. */
  void* hostData;
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

} // namespace mindcraft
