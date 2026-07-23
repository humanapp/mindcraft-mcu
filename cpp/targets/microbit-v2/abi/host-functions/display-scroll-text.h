#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/display-scroll.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-scroll.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

/**
 * Positional arg slot of the `MicroBitDisplay.scrollText` host function: arg 0
 * is the display receiver, arg 1 the text to show.
 */
inline constexpr uint32_t kScrollTextHostFnTextArgSlot = 1;

/**
 * Arg slot of the optional `ScrollTextOptions` struct, and its field ids: the
 * `immediately` flag preempts the current lease at dispatch, `inBackground`
 * resolves the handle at dispatch so the caller does not await the show. Both
 * default false when the struct or the field is absent.
 */
inline constexpr uint32_t kScrollTextHostFnOptionsArgSlot = 2;
inline constexpr uint32_t kScrollTextOptionsImmediatelyField = 0;
inline constexpr uint32_t kScrollTextOptionsInBackgroundField = 1;

/**
 * Async host function `MicroBitDisplay.scrollText`: show the text argument on
 * the display at the default per-step delay - the port scrolls it, or shows a
 * one-character text statically for the completion time the scroll formula
 * gives one character. Arg 0 is the display receiver, arg 1 the text (a
 * non-string reads as empty, a blank scroll of the zero-character duration),
 * arg 2 the optional `ScrollTextOptions` struct carrying the `immediately` and
 * `inBackground` flags (both default false when the struct or a field is
 * absent). When `immediately` is true the current display lease is preempted at
 * dispatch so the show runs at once. The port settles
 * `handle`: it resolves when the show completes, and a show dispatched while the
 * display is busy is dropped and resolves at once. When `inBackground` is true
 * the show keeps its lease but `handle` resolves at dispatch, so the caller
 * continues this round without parking on the animation. An unrecognized
 * receiver resolves the handle at once. `hostData` is the bound
 * {@link MicroBitV2DisplayScrollEnv}. Mirrors the `MicroBitDisplay.scrollText`
 * host function in packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execScrollTextHostFn(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                                   AsyncHandle handle)
{
    MicroBitV2DisplayScrollEnv &env = *static_cast<MicroBitV2DisplayScrollEnv *>(hostData);
    if (args.empty() || !detail::isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitDisplay))
    {
        handle.resolve(kVoidValue);
        return Status::ok();
    }
    // The `immediately` flag preempts the current display lease at dispatch, so
    // the show runs at once even when the display is busy.
    if (optionStructFlag(*env.heap, args, kScrollTextHostFnOptionsArgSlot,
                         kScrollTextOptionsImmediatelyField))
    {
        env.display->preempt();
    }
    const char *bytes = "";
    uint32_t length = 0;
    if (kScrollTextHostFnTextArgSlot < args.size() && args[kScrollTextHostFnTextArgSlot].isString())
    {
        const char *argBytes = nullptr;
        uint32_t argLength = 0;
        if (env.heap->stringContent(args[kScrollTextHostFnTextArgSlot], argBytes, argLength))
        {
            bytes = argBytes;
            length = argLength;
        }
    }
    env.display->scrollText(reinterpret_cast<const uint8_t *>(bytes), length, kScrollDefaultDelayMs,
                            ctx.time, handle);
    // The `inBackground` flag keeps the show's tick-time lease but resolves the
    // handle now, releasing the caller so it does not park on the animation.
    if (optionStructFlag(*env.heap, args, kScrollTextHostFnOptionsArgSlot,
                         kScrollTextOptionsInBackgroundField))
    {
        handle.resolve(kVoidValue);
    }
    return Status::ok();
}

} // namespace mindcraft
