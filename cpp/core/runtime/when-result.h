#pragma once

#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Reserved rule-variable key under which the VM stores each rule's WHEN result
 * at WHEN_END. It is a number key, while author-declared rule variables are
 * always string-named, so it can never collide with one.
 */
inline constexpr mc_number_t kWhenResultRuleVarKey = -1.0f;

/**
 * The value the WHEN side of the in-scope rule last evaluated to, captured into
 * the reserved {@link kWhenResultRuleVarKey} rule variable at WHEN_END.
 * Returns nil when no rule is in scope (`ctx.currentRuleFuncId` is
 * {@link kNoFuncId}) or the in-scope rule has not captured a result. Mirrors
 * `getWhenResult` in
 * external/mindcraft-lang/packages/core/src/runtime/context.ts.
 */
inline Value getWhenResult(const ExecutionContext& ctx, const ManagedHeap& heap) {
  if (ctx.currentRuleFuncId == kNoFuncId || !ctx.ruleVarStores.isMap()) {
    return kNilValue;
  }
  MapObject* outer = heap.map(ctx.ruleVarStores);
  const MapKey ruleKey{true, false, static_cast<mc_number_t>(ctx.currentRuleFuncId), 0};
  if (!heap.mapHas(outer, ruleKey)) {
    return kNilValue;
  }
  MapObject* inner = heap.map(heap.mapGet(outer, ruleKey));
  const MapKey nameKey{true, false, kWhenResultRuleVarKey, 0};
  if (!heap.mapHas(inner, nameKey)) {
    return kNilValue;
  }
  return heap.mapGet(inner, nameKey);
}

} // namespace mindcraft
