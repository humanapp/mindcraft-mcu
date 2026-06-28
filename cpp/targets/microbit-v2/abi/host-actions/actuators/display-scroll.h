#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/binary32-format.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "core/runtime/when-result.h"
#include "targets/microbit-v2/abi/display-scroll.h"

namespace mindcraft
{

/**
 * Positional arg slot of the display scroll actuator, mirroring the flattened
 * call-definition arg slots of the wodal action source
 * (packages/wodal/src/targets/microbit-v2/mindcraft/actions/display-scroll.ts).
 * Slot order is the call spec's declaration order and is wire-stable with the
 * compiler's emitted arg buffers.
 */
inline constexpr uint32_t kDisplayScrollTextArgSlot = 0;

/** Arg slot of the `immediately` modifier: when present, the scroll preempts the current lease. */
inline constexpr uint32_t kDisplayScrollImmediatelyArgSlot = 1;

/** Text scrolled when the call omits the optional text argument. */
inline constexpr char kDisplayScrollDefaultText[] = "hello";

/**
 * The display port and managed heap an async display-scroll body reaches: the
 * display to start the animation, the heap to read the scrolled string's bytes.
 * The caller fills both before the binding's first dispatch.
 */
struct MicroBitV2DisplayScrollEnv
{
    PixelDisplayPort *display;
    ManagedHeap *heap;
};

/**
 * Async host actuator body: scroll text across the display. Reads the optional
 * text argument (defaulting to "hello" when absent); with the `immediately`
 * modifier present it preempts the current display lease so the scroll starts at
 * once. Starts the scroll on the display port at the current think time and
 * leaves `handle` for the port to resolve when the animation completes; the
 * calling fiber awaits it. `hostData` is the bound
 * {@link MicroBitV2DisplayScrollEnv}. Mirrors wodal `actions/display-scroll.ts`.
 */
inline Status execScrollText(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                             AsyncHandle handle)
{
    MicroBitV2DisplayScrollEnv &env = *static_cast<MicroBitV2DisplayScrollEnv *>(hostData);
    const char *bytes = kDisplayScrollDefaultText;
    uint32_t length = sizeof(kDisplayScrollDefaultText) - 1;
    // Holds a numeric WHEN result rendered to text; must outlive the scrollText
    // call below (the display port copies the bytes up front).
    char whenResultBuffer[32];
    const bool hasText =
        kDisplayScrollTextArgSlot < args.size() && !args[kDisplayScrollTextArgSlot].isNil();
    if (hasText)
    {
        const char *argBytes = nullptr;
        uint32_t argLength = 0;
        if (args[kDisplayScrollTextArgSlot].isString() &&
            env.heap->stringContent(args[kDisplayScrollTextArgSlot], argBytes, argLength))
        {
            bytes = argBytes;
            length = argLength;
        }
    }
    else
    {
        // No explicit text argument: fall back to the rule's captured WHEN
        // result. A number renders through the binary32 formatter and a string
        // passes through; any other value (a boolean, nil, or container) keeps
        // the default text.
        const Value whenResult = getWhenResult(ctx, *env.heap);
        if (whenResult.isNumber())
        {
            length = binary32::formatNumber(whenResult.asNumber(), whenResultBuffer);
            bytes = whenResultBuffer;
        }
        else if (whenResult.isString())
        {
            const char *wb = nullptr;
            uint32_t wl = 0;
            if (env.heap->stringContent(whenResult, wb, wl))
            {
                bytes = wb;
                length = wl;
            }
        }
    }
    if (kDisplayScrollImmediatelyArgSlot < args.size() &&
        !args[kDisplayScrollImmediatelyArgSlot].isNil())
    {
        env.display->preempt();
    }
    env.display->scrollText(reinterpret_cast<const uint8_t *>(bytes), length, kScrollDefaultDelayMs,
                            ctx.time, handle);
    return Status::ok();
}

} // namespace mindcraft
