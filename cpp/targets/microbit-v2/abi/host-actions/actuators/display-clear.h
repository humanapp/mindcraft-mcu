#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"

namespace mindcraft
{

/**
 * Host actuator body: blank the 5x5 display, cancelling any held display lease.
 * Takes no arguments. `hostData` is the bound {@link DevicePorts}; the clear
 * crosses the same display port the device-API `MicroBitDisplay.clear` host
 * function reaches. Mirrors wodal `actions/display-clear.ts`.
 */
inline Value execDisplayClearAction(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(ctx);
    static_cast<void>(args);
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    ports.display->clear();
    return kVoidValue;
}

} // namespace mindcraft
