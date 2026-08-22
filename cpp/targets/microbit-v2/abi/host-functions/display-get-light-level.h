#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace wendoo
{

namespace detail
{

/**
 * The display port for a call whose arg 0 is the display receiver, or nullptr
 * when the receiver is missing or of another type. `hostData` is the bound
 * {@link DevicePorts}.
 */
inline PixelDisplayPort *lightLevelReceiver(void *hostData, Span<const Value> args)
{
    if (args.empty() || !isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitDisplay))
    {
        return nullptr;
    }
    return static_cast<DevicePorts *>(hostData)->display;
}

} // namespace detail

/**
 * Host function `MicroBitDisplay.getLightLevel`: reads the ambient light level
 * (0 dark to 255 bright) through the display port. Arg 0 is the display
 * receiver; an unrecognized receiver reads 0. `hostData` is the bound
 * {@link DevicePorts}. Mirrors the `MicroBitDisplay.getLightLevel` body in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
inline Status execDisplayGetLightLevel(void *hostData, Span<const Value> args, Value &result)
{
    PixelDisplayPort *port = detail::lightLevelReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getLightLevel()) : 0);
    return Status::ok();
}

} // namespace wendoo
