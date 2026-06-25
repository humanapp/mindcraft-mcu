#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/host-action.h"
#include "targets/microbit-v2/abi/host-actions.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-draw.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-scroll.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-set-pixel.h"
#include "targets/microbit-v2/abi/host-actions/sensors/button-sensor.h"
#include "targets/microbit-v2/abi/host-actions/sensors/gesture-sensor.h"

namespace mindcraft
{

/** Number of microbit-v2 host-action bindings the slice registers. */
inline constexpr uint32_t kMicroBitV2HostActionBindingCount = 8;

/**
 * Builds the microbit-v2 host-action binding table over `ports`, one entry per
 * action body. The async scroll body uses `scrollEnv` (its display port and
 * heap); the async draw-image body uses `drawEnv` (its display port, heap, and
 * program); the four button sensors use `buttonEnv` (the button port plus the
 * heap and roots backing their per-callsite state); the gesture sensor is
 * stateless and reads the accelerometer port straight off `ports`. Pass null for
 * an env when the table will never dispatch its actions. `ports` and any supplied
 * env must outlive every dispatch through the table.
 */
inline std::array<HostActionBinding, kMicroBitV2HostActionBindingCount>
makeMicroBitV2HostActionBindings(DevicePorts &ports,
                                 MicroBitV2DisplayScrollEnv *scrollEnv = nullptr,
                                 MicroBitV2ButtonSensorEnv *buttonEnv = nullptr,
                                 MicroBitV2DrawImageEnv *drawEnv = nullptr)
{
    return {{
        {MicroBitV2HostActions::ButtonA.actionId, &execButtonA, &buttonSensorPageEntered,
         buttonEnv},
        {MicroBitV2HostActions::DisplaySetPixel.actionId, &execDisplaySetPixel, nullptr, &ports},
        {MicroBitV2HostActions::DisplayScroll.actionId, nullptr, nullptr, scrollEnv,
         &execScrollText},
        {MicroBitV2HostActions::ButtonB.actionId, &execButtonB, &buttonSensorPageEntered,
         buttonEnv},
        {MicroBitV2HostActions::ButtonAB.actionId, &execButtonAB, &buttonSensorPageEntered,
         buttonEnv},
        {MicroBitV2HostActions::ButtonLogo.actionId, &execButtonLogo, &buttonSensorPageEntered,
         buttonEnv},
        {MicroBitV2HostActions::Gesture.actionId, &execGestureSensor, nullptr, &ports},
        {MicroBitV2HostActions::DrawImage.actionId, nullptr, nullptr, drawEnv, &execDrawImage},
    }};
}

} // namespace mindcraft
