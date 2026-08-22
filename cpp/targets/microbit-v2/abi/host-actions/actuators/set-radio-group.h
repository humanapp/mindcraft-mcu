#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"

namespace wendoo
{

/**
 * Positional arg slot of the `set radio group` tile (bag(optional(AnonNumber))):
 * the group number, defaulting to 0 when absent.
 */
inline constexpr uint32_t kSetRadioGroupArgSlot = 0;

/**
 * `set radio group` tile body: sets the device radio group (0-255) from the
 * optional number argument (default 0). `hostData` is the bound
 * {@link DevicePorts}. Mirrors the wodal set-radio-group oracle.
 */
inline Value execSetRadioGroup(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(ctx);
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    if (ports.radio != nullptr)
    {
        ports.radio->setGroup(
            static_cast<int>(detail::numberArgOr(args, kSetRadioGroupArgSlot, 0)));
    }
    return kVoidValue;
}

} // namespace wendoo
