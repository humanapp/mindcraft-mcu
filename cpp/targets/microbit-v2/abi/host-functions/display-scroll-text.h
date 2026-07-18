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
 * Async host function `MicroBitDisplay.scrollText`: show the text argument on
 * the display at the default per-step delay - the port scrolls it, or shows a
 * one-character text statically for the completion time the scroll formula
 * gives one character. Arg 0 is the display receiver, arg 1 the text (a
 * non-string reads as empty, a blank scroll of the zero-character duration).
 * The port settles `handle`: it resolves when the show completes, and a show
 * dispatched while the display is busy is dropped and resolves at once. An
 * unrecognized receiver resolves the handle at once. `hostData` is the bound
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
    return Status::ok();
}

} // namespace mindcraft
