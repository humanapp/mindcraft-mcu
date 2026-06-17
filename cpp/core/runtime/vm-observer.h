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

  /** One fiber fault, raised when the fiber transitions to its fault state. */
  virtual void onFiberFault(uint32_t fiberId, ErrorCode code) = 0;

protected:
  ~VmObserver() = default;
};

} // namespace mindcraft
