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
 * The 5x5 image drawn when the call omits the optional image: the `happy`
 * built-in icon (two eyes over a smiling mouth), as packed brightness bytes
 * (row-major). Mirrors the `happy` entry of the wodal built-in image library
 * (built-in-images.ts), the shared source of the default in both VMs.
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
 * Clips the `Image` struct `imageValue` into `frame` (a
 * `kDrawImageDisplayWidth * kDrawImageDisplayHeight` buffer), writing its clipped
 * size into `width`/`height`, and returns true. Returns false (leaving the
 * outputs untouched) when `imageValue` is not an `Image` (a struct with numeric
 * `width`/`height` and a `pixels` buffer). Pixels are read at the image's own row
 * stride; cells past the buffer's end read as brightness 0.
 */
inline bool clipImageValue(MicroBitV2DrawImageEnv &env, const Value &imageValue, uint8_t *frame,
                           uint32_t &width, uint32_t &height)
{
    if (!imageValue.isStruct())
    {
        return false;
    }
    StructObject *obj = env.heap->structOf(imageValue);
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
 * True when `value` is an `Image` struct that {@link clipImageValue} can clip: a
 * struct with numeric `width`/`height` and a `pixels` buffer.
 */
inline bool isClippableImage(MicroBitV2DrawImageEnv &env, const Value &value)
{
    if (!value.isStruct())
    {
        return false;
    }
    StructObject *obj = env.heap->structOf(value);
    if (obj == nullptr)
    {
        return false;
    }
    return env.heap->structGet(obj, kImageWidthFieldId).isNumber() &&
           env.heap->structGet(obj, kImageHeightFieldId).isNumber() &&
           env.heap->structGet(obj, kImagePixelsFieldId).isBuffer();
}

/**
 * Frame source over the draw-image image slot. The slot is a `List<Image>` (the
 * repeated anonymous image arg) or a bare `Image` / nil (the single-image
 * `drawImage` host function): each clippable element becomes a frame, in order.
 * When no element is clippable the source yields the single default image. The
 * source re-reads the slot per call, so it holds only the slot value and its
 * environment. Mirrors wodal `clipImageSequence` in actions/display-draw.ts.
 */
class DrawImageFrameSource : public DrawFrameSource
{
public:
    DrawImageFrameSource(MicroBitV2DrawImageEnv &env, const Value &slot) : env_(env), slot_(slot) {}

    uint32_t frameCount() override
    {
        const uint32_t clippable = clippableCount();
        return clippable == 0 ? 1 : clippable;
    }

    void writeFrame(uint32_t index, uint8_t *out, uint32_t &width, uint32_t &height) override
    {
        Value image;
        if (nthClippable(index, image) && clipImageValue(env_, image, out, width, height))
        {
            return;
        }
        for (uint32_t i = 0; i < kDrawImageDisplayWidth * kDrawImageDisplayHeight; i++)
        {
            out[i] = kDrawImageDefaultPixels[i];
        }
        width = kDrawImageDisplayWidth;
        height = kDrawImageDisplayHeight;
    }

private:
    MicroBitV2DrawImageEnv &env_;
    Value slot_;

    uint32_t clippableCount()
    {
        if (!slot_.isList())
        {
            return isClippableImage(env_, slot_) ? 1 : 0;
        }
        const ListObject *obj = env_.heap->list(slot_);
        if (obj == nullptr)
        {
            return 0;
        }
        uint32_t count = 0;
        for (uint32_t i = 0; i < obj->size; i++)
        {
            if (isClippableImage(env_, env_.heap->listGet(obj, static_cast<int32_t>(i))))
            {
                count++;
            }
        }
        return count;
    }

    bool nthClippable(uint32_t index, Value &out)
    {
        if (!slot_.isList())
        {
            if (index == 0 && isClippableImage(env_, slot_))
            {
                out = slot_;
                return true;
            }
            return false;
        }
        const ListObject *obj = env_.heap->list(slot_);
        if (obj == nullptr)
        {
            return false;
        }
        uint32_t seen = 0;
        for (uint32_t i = 0; i < obj->size; i++)
        {
            const Value element = env_.heap->listGet(obj, static_cast<int32_t>(i));
            if (isClippableImage(env_, element))
            {
                if (seen == index)
                {
                    out = element;
                    return true;
                }
                seen++;
            }
        }
        return false;
    }
};

/**
 * Async host actuator body: paste one or more `Image`s to the display top-left,
 * clipped to the 5x5 matrix. The image slot is the repeated anonymous arg (a
 * `List<Image>`; when empty or nil the default smiley is drawn); with more than
 * one image they play in sequence, each held for the duration, under one lease.
 * The duration arg is optional (when absent {@link kDrawImageDefaultDurationMs},
 * one second). With the `immediately` modifier present it preempts the current
 * display lease so the draw runs at once. The port settles `handle`: an explicit
 * zero-duration draw resolves at dispatch (no lease; with multiple images only
 * the last is painted), a positive duration holds the display for the whole
 * sequence, and a draw dispatched while the display is busy is dropped and
 * resolves at once. `hostData` is the bound {@link MicroBitV2DrawImageEnv}.
 * Mirrors wodal `actions/display-draw.ts`.
 */
inline Status execDrawImage(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                            AsyncHandle handle)
{
    MicroBitV2DrawImageEnv &env = *static_cast<MicroBitV2DrawImageEnv *>(hostData);
    const Value slot =
        kDrawImageImageArgSlot < args.size() ? args[kDrawImageImageArgSlot] : Value::nil();

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
    DrawImageFrameSource source(env, slot);
    env.display->drawFrames(source, durationMs, ctx.time, handle);
    return Status::ok();
}

} // namespace mindcraft
