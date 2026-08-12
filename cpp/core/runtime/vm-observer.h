#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/error-code.h"
#include "core/runtime/value.h"

namespace mindcraft {

/**
 * Passive taps on the VM's host-binding surface. Implementations observe
 * only; they must not re-enter the VM, the scheduler, or the think loop.
 * Mirrors the observable subset of `VmEvents` in
 * external/mindcraft-lang/packages/core/src/runtime/vm-types.ts.
 */
class VmObserver {
public:
  /**
   * One completed synchronous host-action dispatch. Raised when the call
   * returns; `args` is the positional arg buffer exactly as the binding
   * received it and is valid only for the duration of this call.
   */
  virtual void onHostActionCall(uint32_t actionId, uint32_t callSiteId, Span<const Value> args,
                                const Value& result) = 0;

  /**
   * One asynchronous host-action dispatch. Raised when the body is invoked,
   * before its handle settles; `args` is the positional arg buffer exactly as
   * the binding received it and is valid only for the duration of this call.
   */
  virtual void onHostActionCallAsync(uint32_t actionId, uint32_t callSiteId,
                                     Span<const Value> args) {
    static_cast<void>(actionId);
    static_cast<void>(callSiteId);
    static_cast<void>(args);
  }

  /**
   * One completed synchronous bytecode-action dispatch. Raised when the body
   * hands control back, keyed by the action's slot in the program's action
   * table. `args` is the body's parameter slots as it left them, without any
   * injected context slot, and is valid only for the duration of this call. A
   * body that faults raises nothing.
   */
  virtual void onBytecodeActionCall(uint32_t actionSlot, uint32_t callSiteId,
                                    Span<const Value> args, const Value& result) {
    static_cast<void>(actionSlot);
    static_cast<void>(callSiteId);
    static_cast<void>(args);
    static_cast<void>(result);
  }

  /**
   * One asynchronous bytecode-action dispatch. Raised when the child fiber
   * running the body is spawned, before its handle settles; keyed by the
   * action's slot in the program's action table. `args` is the positional arg
   * buffer the dispatch passed and is valid only for the duration of this call.
   */
  virtual void onBytecodeActionCallAsync(uint32_t actionSlot, uint32_t callSiteId,
                                         Span<const Value> args) {
    static_cast<void>(actionSlot);
    static_cast<void>(callSiteId);
    static_cast<void>(args);
  }

  /** One fiber fault, raised when the fiber transitions to its fault state. */
  virtual void onFiberFault(uint32_t fiberId, ErrorCode code) = 0;

protected:
  ~VmObserver() = default;
};

} // namespace mindcraft
