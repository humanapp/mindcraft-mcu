#pragma once

#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/rule-var-store.h"
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
 * the reserved {@link kWhenResultRuleVarKey} rule variable at WHEN_END. This is
 * the reserved-key case of a rule-variable read: it routes through
 * {@link ruleVarGet}, which walks the rule-ancestor chain, so a rule with no
 * WHEN condition (which captures no result) falls through to the nearest
 * enclosing rule that has one. Returns nil when no rule is in scope or no rule on
 * the chain has captured a result. Mirrors `getWhenResult` in
 * external/mindcraft-lang/packages/core/src/runtime/context.ts, which reads the
 * same reserved key through the rule-variable getter `getByName`.
 */
inline Value getWhenResult(const ExecutionContext& ctx, const ManagedHeap& heap) {
  const MapKey nameKey{true, false, kWhenResultRuleVarKey, 0};
  return ruleVarGet(ctx, heap, ctx.currentRuleFuncId, nameKey);
}

} // namespace mindcraft
