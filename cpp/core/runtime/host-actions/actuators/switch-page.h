#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/brain-runtime.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"

namespace mindcraft {

/** Arg slot of the switch-page number alternative (1-based page number). */
inline constexpr uint32_t kSwitchPageNumberSlot = 0;
/** Arg slot of the switch-page string alternative (stable page id). */
inline constexpr uint32_t kSwitchPageStringSlot = 1;

/**
 * Actuator body: switch the active page. A number argument names a 1-based page
 * number; a string argument names a stable page id; with neither the current
 * page restarts. `hostData` is the bound {@link CoreHostActionEnv}. Mirrors the
 * TS switch-page actuator.
 */
inline Value execSwitchPage(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(ctx);
  CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  if (kSwitchPageNumberSlot < args.size() && args[kSwitchPageNumberSlot].isNumber()) {
    const mc_number_t pageNumber = args[kSwitchPageNumberSlot].asNumber() - 1;
    if (pageNumber >= 0) {
      env.brain->requestPageChange(static_cast<uint32_t>(pageNumber));
    }
    return kVoidValue;
  }
  if (kSwitchPageStringSlot < args.size() && args[kSwitchPageStringSlot].isString()) {
    const char* bytes = nullptr;
    uint32_t length = 0;
    if (env.heap->stringContent(args[kSwitchPageStringSlot], bytes, length)) {
      env.brain->requestPageChangeByPageId(bytes, length);
    }
    return kVoidValue;
  }
  env.brain->requestPageRestart();
  return kVoidValue;
}

} // namespace mindcraft
