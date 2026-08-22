#pragma once

#include "core/platform/span.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/value.h"

namespace wendoo {

/**
 * Sensor body: the stable id of the active page as a string. `hostData` is the
 * bound {@link CoreHostActionEnv}. Mirrors the TS current-page sensor.
 */
inline Value execCurrentPage(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(ctx);
  static_cast<void>(args);
  CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  return env.brain->getCurrentPageId();
}

} // namespace wendoo
