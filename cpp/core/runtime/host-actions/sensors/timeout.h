#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace wendoo {

/** Default timeout delay in seconds when the sensor is called with no argument. */
inline constexpr mc_number_t kTimeoutDefaultDelaySeconds = 1;
/** List index of the timeout's next fire time (milliseconds) in its state. */
inline constexpr int32_t kTimeoutFireTimeIndex = 0;
/** List index of the timeout's last-observed tick number in its state. */
inline constexpr int32_t kTimeoutLastTickIndex = 1;
/**
 * Seed last-tick of a fresh timeout state. On the first think (tick 1) the check
 * `1 != -2 + 1` holds, so the sensor arms `fireTime` and does not fire on entry.
 * Mirrors the TS sensor's initial `lastTick`.
 */
inline constexpr mc_number_t kTimeoutSeedLastTick = -2;
/** Arg slot of the timeout delay (seconds). */
inline constexpr uint32_t kTimeoutDelaySlot = 0;

namespace detail {

/**
 * Allocates a fresh timeout state list `[fireTime=0, lastTick=-2]` into `out`,
 * keeping it rooted across the element appends. Returns false when the heap
 * cannot back the list.
 */
inline bool createTimeoutState(CoreHostActionEnv& env, Value& out) {
  Value listValue;
  if (!env.heap->newList(kNoTypeIdx, env.roots, listValue)) {
    return false;
  }
  ManagedHeap::Pin pin(*env.heap, listValue);
  ListObject* obj = env.heap->list(listValue);
  if (!env.heap->listPush(obj, Value::number(0), env.roots) ||
      !env.heap->listPush(obj, Value::number(kTimeoutSeedLastTick), env.roots)) {
    return false;
  }
  out = listValue;
  return true;
}

} // namespace detail

/**
 * Page-activation hook of the timeout sensor: resets the call site's per-tick
 * timer state. Mirrors the TS sensor's `onPageEntered`.
 */
inline void timeoutPageEntered(void* hostData, ExecutionContext& ctx) {
  CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  Value state;
  if (detail::createTimeoutState(env, state)) {
    ctx.setCallSiteState(state);
  } else {
    ctx.clearCallSiteState();
  }
}

/**
 * Sensor body: true on the think where the delay (seconds, default 1) has
 * elapsed since the last fire, then re-arms. A non-numeric or NaN delay never
 * fires. Skipped ticks re-arm the timer. `hostData` is the bound
 * {@link CoreHostActionEnv}; the per-callsite state is a two-element list
 * `[fireTime, lastTick]`. Mirrors the TS timeout sensor.
 */
inline Value execTimeout(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  mc_number_t delay = kTimeoutDefaultDelaySeconds;
  if (kTimeoutDelaySlot < args.size() && !args[kTimeoutDelaySlot].isNil()) {
    const Value& delayArg = args[kTimeoutDelaySlot];
    if (!delayArg.isNumber() || delayArg.asNumber() != delayArg.asNumber()) {
      return kFalseValue;
    }
    delay = delayArg.asNumber();
  }

  Value stateValue;
  if (ctx.hasCallSiteState() && ctx.callSiteState().isList()) {
    stateValue = ctx.callSiteState();
  } else if (detail::createTimeoutState(env, stateValue)) {
    ctx.setCallSiteState(stateValue);
  } else {
    return kFalseValue;
  }

  ListObject* obj = env.heap->list(stateValue);
  mc_number_t fireTime = env.heap->listGet(obj, kTimeoutFireTimeIndex).asNumber();
  mc_number_t lastTick = env.heap->listGet(obj, kTimeoutLastTickIndex).asNumber();

  bool shouldFire = false;
  if (static_cast<mc_number_t>(ctx.currentTick) != lastTick + 1) {
    fireTime = ctx.time + delay * 1000.0f;
  }
  if (ctx.time >= fireTime) {
    shouldFire = true;
    fireTime = ctx.time + delay * 1000.0f;
  }
  lastTick = static_cast<mc_number_t>(ctx.currentTick);

  env.heap->listSet(obj, kTimeoutFireTimeIndex, Value::number(fireTime));
  env.heap->listSet(obj, kTimeoutLastTickIndex, Value::number(lastTick));
  return shouldFire ? kTrueValue : kFalseValue;
}

} // namespace wendoo
