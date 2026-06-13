#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Synchronous host-action body. `args` is an ephemeral view of the
 * positional arg buffer (argc slots; a missing optional slot is nil) valid
 * only for the duration of the call; `hostData` is the pointer the action
 * was registered with. The bound call site is
 * `ctx.currentCallSiteId`. Returns the value the call pushes back.
 */
using HostActionExecSync = Value (*)(void* hostData, ExecutionContext& ctx, Span<const Value> args);

/**
 * Page-lifecycle hook of a host action. Invoked with the hook's call site
 * bound on `ctx.currentCallSiteId`.
 */
using HostActionPageHook = void (*)(void* hostData, ExecutionContext& ctx);

/**
 * One registered host action: its stable action id, the synchronous body,
 * the optional page-activation hook, and the opaque pointer passed back to
 * both.
 */
struct HostActionBinding {
  /** Stable host-action id (the `HOST_ACTION_CALL` operand). */
  uint32_t actionId;

  /** Synchronous body. Must be non-null. */
  HostActionExecSync execSync;

  /** Hook run on page activation for each of the action's call sites, or null. */
  HostActionPageHook onPageEntered;

  /** Opaque pointer handed to {@link execSync} and {@link onPageEntered}. */
  void* hostData;
};

/**
 * Returns the registration holding `actionId`, or nullptr when no entry of
 * `bindings` does.
 */
inline const HostActionBinding* findHostActionById(Span<const HostActionBinding> bindings,
                                                   uint32_t actionId) {
  for (size_t i = 0; i < bindings.size(); i++) {
    if (bindings[i].actionId == actionId) {
      return &bindings[i];
    }
  }
  return nullptr;
}

} // namespace mindcraft
