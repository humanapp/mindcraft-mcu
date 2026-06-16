#pragma once

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Actuator body: yield. The body is a no-op; the rule's cooperative suspension
 * is the compiler-emitted `YIELD` opcode. Mirrors the TS yield actuator.
 */
inline Value execYield(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(hostData);
  static_cast<void>(ctx);
  static_cast<void>(args);
  return kVoidValue;
}

} // namespace mindcraft
