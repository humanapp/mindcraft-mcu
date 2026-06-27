#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/numeric.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-draw.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

/**
 * Positional arg slots of the `MicroBitDisplay.drawImage` host function: arg 0 is
 * the display receiver, arg 1 the `Image` to draw, arg 2 the optional hold
 * duration in seconds.
 */
inline constexpr uint32_t kDrawImageHostFnImageArgSlot = 1;
inline constexpr uint32_t kDrawImageHostFnDurationArgSlot = 2;

/**
 * Async host function `MicroBitDisplay.drawImage`: paste the `Image` argument to
 * the display top-left, clipped to the 5x5 matrix, and hold the display lease for
 * the duration. Arg 0 is the display receiver, arg 1 the `Image`
 * (when absent or not an `Image` the default smiley is drawn), arg 2 the optional
 * hold duration in seconds (when absent {@link kDrawImageDefaultDurationMs}, one
 * second). The port settles `handle`: an explicit zero-duration draw resolves at
 * dispatch (no lease), a positive duration holds the display, and a draw
 * dispatched while the display is busy is dropped and resolves at once. An
 * unrecognized receiver resolves the handle at once. `hostData` is the bound
 * {@link MicroBitV2DrawImageEnv}. Mirrors the `MicroBitDisplay.drawImage` host
 * function in packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execDrawImageHostFn(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                                  AsyncHandle handle)
{
    MicroBitV2DrawImageEnv &env = *static_cast<MicroBitV2DrawImageEnv *>(hostData);
    if (args.empty() || !detail::isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitDisplay))
    {
        handle.resolve(kVoidValue);
        return Status::ok();
    }

    const Value image = kDrawImageHostFnImageArgSlot < args.size()
                            ? args[kDrawImageHostFnImageArgSlot]
                            : Value::nil();

    uint32_t durationMs = kDrawImageDefaultDurationMs;
    if (kDrawImageHostFnDurationArgSlot < args.size() &&
        args[kDrawImageHostFnDurationArgSlot].isNumber())
    {
        // Convert the seconds argument to whole ms.
        durationMs =
            toNonNegativeInteger(args[kDrawImageHostFnDurationArgSlot].asNumber() * 1000.0f);
    }
    // This host function draws a single image, leased as a one-frame sequence.
    DrawImageFrameSource source(env, image);
    env.display->drawFrames(source, durationMs, ctx.time, handle);
    return Status::ok();
}

} // namespace mindcraft
