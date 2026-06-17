#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/host-function.h"
#include "targets/microbit-v2/abi/host-func-id.h"
#include "targets/microbit-v2/abi/host-functions/button-is-pressed.h"
#include "targets/microbit-v2/abi/host-functions/display-set-pixel-value.h"

namespace mindcraft
{

/** Number of microbit-v2 target host-function bindings the slice registers. */
inline constexpr uint32_t kMicroBitV2HostFuncBindingCount = 2;

/**
 * Builds the microbit-v2 target host-function binding table over `ports`, one
 * entry per body. `ports` must outlive every dispatch through the table.
 */
inline std::array<TargetHostFuncBinding, kMicroBitV2HostFuncBindingCount>
makeMicroBitV2HostFuncBindings(DevicePorts &ports)
{
    return {{
        {static_cast<uint32_t>(MicroBitV2HostFuncId::ButtonIsPressed), &execButtonIsPressed,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::DisplaySetPixelValue),
         &execDisplaySetPixelValue, &ports},
    }};
}

} // namespace mindcraft
