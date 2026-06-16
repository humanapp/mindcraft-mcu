#pragma once

#include "core/platform/span.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Sensor body: the stable id of the most recently deactivated page as a string,
 * or the current page's id when none. `hostData` is the bound
 * {@link CoreHostActionEnv}. Mirrors the TS previous-page sensor.
 */
inline Value execPreviousPage(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(ctx);
  static_cast<void>(args);
  CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  return env.brain->getPreviousPageId();
}

} // namespace mindcraft
