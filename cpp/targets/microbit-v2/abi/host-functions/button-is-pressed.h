#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
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

} // namespace mindcraft
