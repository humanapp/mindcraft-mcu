#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * The rule immediately above `ruleFuncId` at its own nesting level, or
 * {@link kNoFuncId} when `ruleFuncId` is the first rule at its level.
 *
 * A rule with an entry in `program.ruleAncestors` is a child: its subject is the
 * entry sharing its parent with the largest funcId below its own. A rule with no
 * entry is a root: its subject is its predecessor in its page's root-rule run.
 * Both derivations rest on rule funcIds being assigned in a pre-order
 * document-order walk, so a rule's whole subtree sits above it.
 */
inline uint32_t precedingSiblingRuleFuncId(const ProgramImage& program, uint32_t ruleFuncId) {
  if (ruleFuncId == kNoFuncId) {
    return kNoFuncId;
  }
  uint32_t parentFuncId = kNoFuncId;
  for (const RuleAncestor& edge : program.ruleAncestors) {
    if (edge.ruleFuncId == ruleFuncId) {
      parentFuncId = edge.parentRuleFuncId;
      break;
    }
  }
  if (parentFuncId != kNoFuncId) {
    uint32_t best = kNoFuncId;
    for (const RuleAncestor& edge : program.ruleAncestors) {
      if (edge.parentRuleFuncId != parentFuncId || edge.ruleFuncId >= ruleFuncId) {
        continue;
      }
      if (best == kNoFuncId || edge.ruleFuncId > best) {
        best = edge.ruleFuncId;
      }
    }
    return best;
  }
  for (const PageMetadata& page : program.pages) {
    for (uint32_t i = 0; i < page.rootRuleFuncIdsCount; i++) {
      if (program.rootRuleFuncIds[page.rootRuleFuncIdsOffset + i] != ruleFuncId) {
        continue;
      }
      return i == 0 ? kNoFuncId : program.rootRuleFuncIds[page.rootRuleFuncIdsOffset + i - 1];
    }
  }
  return kNoFuncId;
}

/**
 * Sensor body: true when the rule immediately above this one at its own nesting
 * level evaluated its WHEN and did not fire. A subject that fired, one still
 * evaluating, a rule with no preceding sibling, and a dispatch outside any rule
 * all read false. `hostData` is the bound {@link CoreHostActionEnv}. Mirrors the
 * TS otherwise sensor.
 */
inline Value execOtherwise(void* hostData, ExecutionContext& ctx, Span<const Value> args) {
  static_cast<void>(args);
  const CoreHostActionEnv& env = *static_cast<CoreHostActionEnv*>(hostData);
  if (env.program == nullptr) {
    return Value::boolean(false);
  }
  const uint32_t subject = precedingSiblingRuleFuncId(*env.program, ctx.currentRuleFuncId);
  if (subject == kNoFuncId) {
    return Value::boolean(false);
  }
  return Value::boolean(ctx.ruleFiringState(subject) == RuleFiringState::DidNotFire);
}

} // namespace mindcraft
