#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/buffer-value.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/numeric.h"
#include "core/runtime/program.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"

namespace mindcraft
{

/**
 * Positional arg slots of the draw-image actuator, mirroring the flattened
 * call-definition arg slots of the wodal action source
 * (packages/wodal/src/targets/microbit-v2/mindcraft/actions/display-draw.ts):
 * slot 0 is the required `Image`, slot 1 the optional duration.
 */
inline constexpr uint32_t kDrawImageImageArgSlot = 0;
inline constexpr uint32_t kDrawImageDurationArgSlot = 1;

/** Arg slot of the `immediately` modifier: when present, the draw preempts the current lease. */
inline constexpr uint32_t kDrawImageImmediatelyArgSlot = 2;

/** Field ids and storage slots of the `Image` struct, mirroring ImageField in tile-ids.ts. */
inline constexpr uint32_t kImageWidthFieldId = 0;
inline constexpr uint32_t kImageHeightFieldId = 1;
inline constexpr uint32_t kImagePixelsFieldId = 2;

/** Display matrix size; an image is pasted top-left and clipped to it. */
inline constexpr uint32_t kDrawImageDisplayWidth = 5;
inline constexpr uint32_t kDrawImageDisplayHeight = 5;

/** Milliseconds a draw holds the display when the call omits the optional duration (1 second). */
inline constexpr uint32_t kDrawImageDefaultDurationMs = 1000;

/**
 * The 5x5 smiley drawn when the call omits the optional image, as packed
 * brightness bytes (row-major): two eyes over a smiling mouth. Inline
 * placeholder until the built-in image library exists. Mirrors DEFAULT_IMAGE in
 * wodal actions/display-draw.ts.
 */
inline constexpr uint8_t kDrawImageDefaultPixels[kDrawImageDisplayWidth * kDrawImageDisplayHeight] =
    {
        0,   0,   0,   0,   0,   //
        0,   255, 0,   255, 0,   //
        0,   0,   0,   0,   0,   //
        255, 0,   0,   0,   255, //
        0,   255, 255, 255, 0,   //
};

/**
 * The display port, managed heap, and program image a draw-image body reaches:
 * the display to paste and hold the frame, the heap to read the `Image` struct's
 * fields and a managed pixel buffer, and the program to resolve a borrowed
 * (constant) pixel buffer's bytes. The caller fills all three before the
 * binding's first dispatch.
 */
struct MicroBitV2DrawImageEnv
{
    PixelDisplayPort *display;
    ManagedHeap *heap;
    const ProgramImage *program;
};

/**
 * Clips the `Image` struct at `args[kDrawImageImageArgSlot]` into `frame` (a
 * `kDrawImageDisplayWidth * kDrawImageDisplayHeight` buffer), writing its clipped
 * size into `width`/`height`, and returns true. Returns false (leaving the
 * outputs untouched) when the slot is absent or is not an `Image` (a struct with
 * numeric `width`/`height` and a `pixels` buffer). Pixels are read at the image's
 * own row stride; cells past the buffer's end read as brightness 0.
 */
inline bool clipDrawImageArg(MicroBitV2DrawImageEnv &env, Span<const Value> args, uint8_t *frame,
                             uint32_t &width, uint32_t &height)
{
    if (kDrawImageImageArgSlot >= args.size() || !args[kDrawImageImageArgSlot].isStruct())
    {
        return false;
    }
    StructObject *obj = env.heap->structOf(args[kDrawImageImageArgSlot]);
    if (obj == nullptr)
    {
        return false;
    }
    const Value widthValue = env.heap->structGet(obj, kImageWidthFieldId);
    const Value heightValue = env.heap->structGet(obj, kImageHeightFieldId);
    const Value pixelsValue = env.heap->structGet(obj, kImagePixelsFieldId);
    if (!widthValue.isNumber() || !heightValue.isNumber() || !pixelsValue.isBuffer())
    {
        return false;
    }

    const uint8_t *pixels = nullptr;
    uint32_t pixelCount = 0;
    if (pixelsValue.isManagedBuffer())
    {
        if (!env.heap->bufferContent(pixelsValue, pixels, pixelCount))
        {
            return false;
        }
    }
    else
    {
        const ByteSpan span = bufferBytes(*env.program, pixelsValue);
        pixels = span.data();
        pixelCount = static_cast<uint32_t>(span.size());
    }

    const uint32_t imageWidth = toNonNegativeInteger(widthValue.asNumber());
    const uint32_t imageHeight = toNonNegativeInteger(heightValue.asNumber());
    width = imageWidth < kDrawImageDisplayWidth ? imageWidth : kDrawImageDisplayWidth;
    height = imageHeight < kDrawImageDisplayHeight ? imageHeight : kDrawImageDisplayHeight;
    for (uint32_t row = 0; row < height; row++)
    {
        for (uint32_t col = 0; col < width; col++)
        {
            const uint32_t index = row * imageWidth + col;
            frame[row * width + col] = index < pixelCount ? pixels[index] : 0;
        }
    }
    return true;
}

/**
 * Async host actuator body: paste an `Image` to the display top-left, clipped to
 * the 5x5 matrix. Both args are optional: the `Image` (when absent the default
 * smiley is drawn) and the hold duration in seconds (when absent
 * {@link kDrawImageDefaultDurationMs}, one second). With the `immediately`
 * modifier present it preempts the current display lease so the draw runs at
 * once. The port settles `handle`: an explicit zero-duration draw resolves at
 * dispatch (no lease), a positive duration holds the display, and a draw
 * dispatched while the display is busy is dropped and resolves at once.
 * `hostData` is the bound {@link MicroBitV2DrawImageEnv}. Mirrors wodal
 * `actions/display-draw.ts`.
 */
inline Status execDrawImage(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                            AsyncHandle handle)
{
    MicroBitV2DrawImageEnv &env = *static_cast<MicroBitV2DrawImageEnv *>(hostData);
    uint8_t frame[kDrawImageDisplayWidth * kDrawImageDisplayHeight] = {};
    uint32_t width = 0;
    uint32_t height = 0;
    if (!clipDrawImageArg(env, args, frame, width, height))
    {
        for (uint32_t i = 0; i < kDrawImageDisplayWidth * kDrawImageDisplayHeight; i++)
        {
            frame[i] = kDrawImageDefaultPixels[i];
        }
        width = kDrawImageDisplayWidth;
        height = kDrawImageDisplayHeight;
    }

    uint32_t durationMs = kDrawImageDefaultDurationMs;
    if (kDrawImageDurationArgSlot < args.size() && args[kDrawImageDurationArgSlot].isNumber())
    {
        // Convert the seconds argument to whole ms.
        durationMs = toNonNegativeInteger(args[kDrawImageDurationArgSlot].asNumber() * 1000.0f);
    }
    if (kDrawImageImmediatelyArgSlot < args.size() && !args[kDrawImageImmediatelyArgSlot].isNil())
    {
        env.display->preempt();
    }
    env.display->drawFrame(frame, width, height, durationMs, ctx.time, handle);
    return Status::ok();
}

} // namespace mindcraft
