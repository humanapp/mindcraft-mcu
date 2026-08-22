#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"

namespace wendoo
{

/**
 * Positional arg slots of the display set-pixel actuator, mirroring the
 * flattened call-definition arg slots of the wodal action source
 * (packages/wodal/src/targets/microbit-v2/wendoo/actions/display-set-pixel.ts).
 * Slot order is the call spec's declaration order and is wire-stable with the
 * compiler's emitted arg buffers.
 */
inline constexpr uint32_t kDisplaySetPixelXArgSlot = 0;
inline constexpr uint32_t kDisplaySetPixelYArgSlot = 1;
inline constexpr uint32_t kDisplaySetPixelBrightnessArgSlot = 2;

/** Argument defaults of the display set-pixel action. */
inline constexpr mc_number_t kDisplaySetPixelDefaultX = 0;
inline constexpr mc_number_t kDisplaySetPixelDefaultY = 0;
inline constexpr mc_number_t kDisplaySetPixelDefaultBrightness = 255;

/**
 * Host actuator body: set one LED pixel brightness. Optional x/y/brightness
 * arguments default to 0/0/255 and are narrowed to the port's int16 coordinate
 * and uint8 brightness parameters; the device drops a write whose coordinate is
 * outside the matrix. `hostData` is the bound {@link DevicePorts}. Mirrors wodal
 * `actions/display-set-pixel.ts`.
 */
inline Value execDisplaySetPixel(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(ctx);
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    const mc_number_t x =
        detail::numberArgOr(args, kDisplaySetPixelXArgSlot, kDisplaySetPixelDefaultX);
    const mc_number_t y =
        detail::numberArgOr(args, kDisplaySetPixelYArgSlot, kDisplaySetPixelDefaultY);
    const mc_number_t brightness = detail::numberArgOr(args, kDisplaySetPixelBrightnessArgSlot,
                                                       kDisplaySetPixelDefaultBrightness);
    ports.display->setPixel(detail::pixelCoordToPort(x), detail::pixelCoordToPort(y),
                            detail::brightnessToPort(brightness));
    return kVoidValue;
}

} // namespace wendoo
