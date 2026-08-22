#pragma once

#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"

namespace wendoo {

/**
 * The parent rule of `ruleFuncId` per {@link ExecutionContext::ruleAncestors},
 * or {@link kNoFuncId} when it is a root rule with no enclosing rule.
 */
inline uint32_t parentRuleFuncId(const ExecutionContext& ctx, uint32_t ruleFuncId) {
  for (uint32_t i = 0; i < ctx.ruleAncestors.size(); i++) {
    if (ctx.ruleAncestors[i].ruleFuncId == ruleFuncId) {
      return ctx.ruleAncestors[i].parentRuleFuncId;
    }
  }
  return kNoFuncId;
}

/**
 * Reads a rule-scoped variable, walking the rule-ancestor chain: `ruleFuncId`'s
 * own inner map first, then each parent via
 * {@link ExecutionContext::ruleAncestors}, until an inner map holds `nameKey`,
 * else nil. This is the one rule-variable getter; both `RuleContext.getVariable`
 * and the WHEN-result accessor route through it, so the walk lives in exactly one
 * place. Returns nil when no rule is in scope, no store has been allocated, or
 * the name is unset along the whole chain. Mirrors `getByName` in
 * external/wendoo-lang/packages/core/src/runtime/rule-services.ts.
 */
inline Value ruleVarGet(const ExecutionContext& ctx, const ManagedHeap& heap, uint32_t ruleFuncId,
                        const MapKey& nameKey) {
  if (ruleFuncId == kNoFuncId || !ctx.ruleVarStores.isMap()) {
    return kNilValue;
  }
  MapObject* outer = heap.map(ctx.ruleVarStores);
  uint32_t cur = ruleFuncId;
  while (cur != kNoFuncId) {
    const MapKey ruleKey{true, false, static_cast<mc_number_t>(cur), 0};
    if (heap.mapHas(outer, ruleKey)) {
      MapObject* inner = heap.map(heap.mapGet(outer, ruleKey));
      if (heap.mapHas(inner, nameKey)) {
        return heap.mapGet(inner, nameKey);
      }
    }
    cur = parentRuleFuncId(ctx, cur);
  }
  return kNilValue;
}

} // namespace wendoo
