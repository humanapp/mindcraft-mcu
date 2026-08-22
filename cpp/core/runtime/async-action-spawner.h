#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/error-code.h"
#include "core/runtime/value.h"

namespace wendoo {

/**
 * Spawns a child fiber for an async bytecode action dispatched by
 * `ACTION_CALL_ASYNC`. {@link FiberScheduler} implements it; the host wires it
 * onto {@link RuntimeSurface::spawner}, through which the dispatch loop invokes
 * it.
 */
struct AsyncActionSpawner {
  /**
   * Spawns an async action child running `entryFuncId`, seeding `args` as its
   * locals and binding its entry frame as an async action frame keyed by
   * (`actionId`, `callSiteId`) and inheriting `ruleFuncId`. Allocates the
   * child's pending result handle and links it so the child's completion settles
   * it, then enqueues the child for the next round. Returns the new handle id,
   * or {@link kNoHandleId} with `err` set on a fiber/handle cap or region
   * exhaustion. Mirrors `spawnBytecodeActionFiber` plus the handle wiring in
   * `execActionCallAsync` in
   * external/wendoo-lang/packages/core/src/runtime/vm.ts.
   */
  virtual uint32_t spawnAsyncActionChild(uint32_t entryFuncId, uint32_t actionId,
                                         uint32_t callSiteId, uint32_t ruleFuncId,
                                         Span<const Value> args, ErrorCode& err) = 0;

protected:
  ~AsyncActionSpawner() = default;
};

} // namespace wendoo
