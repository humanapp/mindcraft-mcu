#pragma once

#include <cstdint>

#include "core/runtime/error-code.h"

namespace mindcraft {

/**
 * Spawns a fire-and-forget child-rule fiber dispatched by `SPAWN_RULE`.
 * {@link FiberScheduler} implements it; the host wires it onto
 * {@link RuntimeSurface::childRuleSpawner}, through which the dispatch loop
 * invokes it.
 */
struct ChildRuleSpawner {
  /**
   * Spawns a child-rule fiber running `funcId`, links it to the spawning fiber
   * for the cancellation cascade, and enqueues it for the next round. Returns
   * true on success; returns false with `err` set on a fiber-pool cap or region
   * exhaustion. Mirrors `spawnChildRule` in
   * external/mindcraft-lang/packages/core/src/runtime/vm.ts.
   */
  virtual bool spawnChildRule(uint32_t funcId, ErrorCode& err) = 0;

protected:
  ~ChildRuleSpawner() = default;
};

} // namespace mindcraft
