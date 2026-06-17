#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

/**
 * Host function `MicroBitDisplay.setPixelValue`: writes one LED pixel through
 * the display port. Arg 0 is the display receiver; args 1..3 are x, y, and
 * brightness, defaulting to 0 when absent or non-numeric, narrowed to the port's
 * int16 coordinate and uint8 brightness parameters; the device drops a write
 * whose coordinate is outside the matrix, and an unrecognized receiver is a
 * no-op. `hostData` is the bound {@link DevicePorts}. Mirrors the
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
        ports.display->setPixel(detail::pixelCoordToPort(x), detail::pixelCoordToPort(y),
                                detail::brightnessToPort(brightness));
    }
    result = kVoidValue;
    return Status::ok();
}

} // namespace mindcraft
