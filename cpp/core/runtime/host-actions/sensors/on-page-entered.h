#pragma once

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Page-activation hook of the on-page-entered sensor: arms the call site to fire
 * once. Mirrors the TS sensor's `onPageEntered`.
 */
inline void onPageEnteredPageEntered(void* hostData, ExecutionContext& ctx) {
  static_cast<void>(hostData);
  ctx.setCallSiteState(kFalseValue);
}

/**
 * Sensor body: true on the first evaluation after the page is entered, false
 * thereafter. The call-site state holds whether it has fired. Mirrors the TS
 * on-page-entered sensor.
 */
inline Value execOnPageEntered(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(hostData);
  static_cast<void>(args);
  if (ctx.hasCallSiteState() && ctx.callSiteState().isBoolean() &&
      !ctx.callSiteState().asBoolean()) {
    ctx.setCallSiteState(kTrueValue);
    return kTrueValue;
  }
  return kFalseValue;
}

} // namespace mindcraft
