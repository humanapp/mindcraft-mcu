#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/host-action.h"
#include "targets/microbit-v2/abi/host-actions.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-scroll.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-set-pixel.h"
#include "targets/microbit-v2/abi/host-actions/sensors/button-a.h"

namespace mindcraft
{

/** Number of microbit-v2 host-action bindings the slice registers. */
inline constexpr uint32_t kMicroBitV2HostActionBindingCount = 3;

/**
 * Builds the microbit-v2 host-action binding table over `ports`, one entry per
 * action body. The async scroll body uses `scrollEnv` (its display port and
 * heap); pass null when the table will never dispatch a scroll. `ports` and
 * `scrollEnv` must outlive every dispatch through the table.
 */
inline std::array<HostActionBinding, kMicroBitV2HostActionBindingCount>
makeMicroBitV2HostActionBindings(DevicePorts &ports,
                                 MicroBitV2DisplayScrollEnv *scrollEnv = nullptr)
{
    return {{
        {MicroBitV2HostActions::ButtonA.actionId, &execButtonA, &buttonAPageEntered, &ports},
        {MicroBitV2HostActions::DisplaySetPixel.actionId, &execDisplaySetPixel, nullptr, &ports},
        {MicroBitV2HostActions::DisplayScroll.actionId, nullptr, nullptr, scrollEnv,
         &execScrollText},
    }};
}

} // namespace mindcraft
