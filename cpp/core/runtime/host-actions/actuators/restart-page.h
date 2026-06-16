#pragma once

#include "core/platform/span.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Actuator body: restart the current page at the next think. `hostData` is the
 * bound {@link CoreHostActionEnv}. Mirrors the TS restart-page actuator.
 */
inline Value execRestartPage(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(ctx);
  static_cast<void>(args);
  CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  env.brain->requestPageRestart();
  return kVoidValue;
}

} // namespace mindcraft
