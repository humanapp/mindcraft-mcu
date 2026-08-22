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

namespace wendoo
{

/**
 * Positional arg slots of the `MicroBitDisplay.drawImage` host function: arg 0 is
 * the display receiver, arg 1 the `Image` to draw.
 */
inline constexpr uint32_t kDrawImageHostFnImageArgSlot = 1;

/**
 * Arg slot of the optional `DrawImageOptions` struct, and its field ids: the
 * `duration` field is the hold in seconds (absent -> the one-second default),
 * `immediately` preempts the current lease at dispatch, and `inBackground`
 * resolves the handle at dispatch so the caller does not await the hold. Each
 * defaults off when the struct or the field is absent.
 */
inline constexpr uint32_t kDrawImageHostFnOptionsArgSlot = 2;
inline constexpr uint32_t kDrawImageOptionsDurationField = 0;
inline constexpr uint32_t kDrawImageOptionsImmediatelyField = 1;
inline constexpr uint32_t kDrawImageOptionsInBackgroundField = 2;

/**
 * Async host function `MicroBitDisplay.drawImage`: paste the `Image` argument to
 * the display top-left, clipped to the 5x5 matrix, and hold the display lease for
 * the duration. Arg 0 is the display receiver, arg 1 the `Image`
 * (when absent or not an `Image` the default smiley is drawn), arg 2 the optional
 * `DrawImageOptions` struct carrying the hold `duration` in seconds (when absent
 * {@link kDrawImageDefaultDurationMs}, one second) and the `immediately` and
 * `inBackground` flags (both default false). When `immediately` is true the
 * current display lease is preempted at dispatch so the draw runs at once. The
 * port settles `handle`: an explicit zero-duration draw resolves at dispatch (no
 * lease), a positive duration holds the display, and a draw dispatched while the
 * display is busy is dropped and resolves at once. When `inBackground` is true the
 * draw keeps its lease but `handle` resolves at dispatch, so the caller continues
 * this round without parking on the hold; this is distinct from a zero duration,
 * which takes no lease at all. An unrecognized receiver resolves the handle at
 * once. `hostData` is the bound {@link MicroBitV2DrawImageEnv}. Mirrors the
 * `MicroBitDisplay.drawImage` host function in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
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
    // The `immediately` flag preempts the current display lease at dispatch, so
    // the draw runs at once even when the display is busy.
    if (optionStructFlag(*env.heap, args, kDrawImageHostFnOptionsArgSlot,
                         kDrawImageOptionsImmediatelyField))
    {
        env.display->preempt();
    }

    const Value image = kDrawImageHostFnImageArgSlot < args.size()
                            ? args[kDrawImageHostFnImageArgSlot]
                            : Value::nil();

    uint32_t durationMs = kDrawImageDefaultDurationMs;
    const Value durationValue = optionStructField(*env.heap, args, kDrawImageHostFnOptionsArgSlot,
                                                  kDrawImageOptionsDurationField);
    if (durationValue.isNumber())
    {
        // Convert the seconds argument to whole ms.
        durationMs = toNonNegativeInteger(durationValue.asNumber() * 1000.0f);
    }
    // This host function draws a single image, leased as a one-frame sequence.
    DrawImageFrameSource source(env, image);
    env.display->drawFrames(source, durationMs, ctx.time, handle);
    // The `inBackground` flag keeps the draw's tick-time lease but resolves the
    // handle now, releasing the caller so it does not park on the hold. It is
    // distinct from a zero duration, which takes no lease at all.
    if (optionStructFlag(*env.heap, args, kDrawImageHostFnOptionsArgSlot,
                         kDrawImageOptionsInBackgroundField))
    {
        handle.resolve(kVoidValue);
    }
    return Status::ok();
}

} // namespace wendoo
