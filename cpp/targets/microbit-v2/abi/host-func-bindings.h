#pragma once

#include <array>
#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/host-function.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-action-bindings.h"
#include "targets/microbit-v2/abi/host-func-id.h"
#include "targets/microbit-v2/abi/microbit-field.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

namespace detail
{

/**
 * The button port index of a `Button` receiver: the discriminator a native
 * struct carries is the producing `MicroBitField` id, so subtracting the first
 * button field maps button A to port 0 and button B to port 1.
 */
inline uint8_t buttonPortIndex(uint32_t discriminator)
{
    return static_cast<uint8_t>(discriminator - static_cast<uint32_t>(MicroBitField::ButtonA));
}

/** True when `value` is a native struct of `typeAtomId`. */
inline bool isReceiver(const Value &value, MicroBitV2TypeAtomId typeAtomId)
{
    return value.isStruct() && value.typeId() == static_cast<uint32_t>(typeAtomId);
}

} // namespace detail

/**
 * Host function `Button.isPressed`: reads the receiver button's level through
 * the button port and returns 1 when pressed, 0 otherwise. Arg 0 is the button
 * receiver; an unrecognized receiver reads 0. `hostData` is the bound
 * {@link DevicePorts}. Mirrors the `Button.isPressed` body in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execButtonIsPressed(void *hostData, Span<const Value> args, Value &result)
{
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    bool pressed = false;
    if (!args.empty() && detail::isReceiver(args[0], MicroBitV2TypeAtomId::Button))
    {
        pressed = ports.buttons->isPressed(detail::buttonPortIndex(args[0].structHandle()));
    }
    result = Value::number(pressed ? 1.0f : 0.0f);
    return Status::ok();
}

/**
 * Host function `MicroBitDisplay.setPixelValue`: writes one LED pixel through
 * the display port. Arg 0 is the display receiver; args 1..3 are x, y, and
 * brightness, defaulting to 0 when absent or non-numeric. The write crosses the
 * port unless a coordinate cannot cross its u8 width; an unrecognized receiver
 * is a no-op. `hostData` is the bound {@link DevicePorts}. Mirrors the
 * `MicroBitDisplay.setPixelValue` body in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execDisplaySetPixelValue(void *hostData, Span<const Value> args, Value &result)
{
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    if (!args.empty() && detail::isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitDisplay))
    {
        const mc_number_t x = detail::numberArgOr(args, 1, 0);
        const mc_number_t y = detail::numberArgOr(args, 2, 0);
        const mc_number_t brightness = detail::numberArgOr(args, 3, 0);
        uint8_t portX = 0;
        uint8_t portY = 0;
        if (detail::pixelCoordToPort(x, portX) && detail::pixelCoordToPort(y, portY))
        {
            ports.display->setPixel(portX, portY, detail::brightnessToPort(brightness));
        }
    }
    result = kVoidValue;
    return Status::ok();
}

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
