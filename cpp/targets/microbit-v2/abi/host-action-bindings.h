#pragma once

#include <array>
#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/handle-table.h"
#include "core/runtime/host-action.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/display-scroll.h"
#include "targets/microbit-v2/abi/host-actions.h"

namespace mindcraft
{

/**
 * Positional arg slots of the microbit-v2 host actions, mirroring the
 * flattened call-definition arg slots of the wodal action sources
 * (packages/wodal/src/targets/microbit-v2/mindcraft/actions/). Slot order is
 * the call spec's declaration order and is wire-stable with the compiler's
 * emitted arg buffers.
 */
inline constexpr uint32_t kButtonAPressedArgSlot = 0;
inline constexpr uint32_t kButtonAReleasedArgSlot = 1;
inline constexpr uint32_t kDisplaySetPixelXArgSlot = 0;
inline constexpr uint32_t kDisplaySetPixelYArgSlot = 1;
inline constexpr uint32_t kDisplaySetPixelBrightnessArgSlot = 2;
inline constexpr uint32_t kDisplayScrollTextArgSlot = 0;

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

/** Button-port index of button A. */
inline constexpr uint8_t kButtonAPortIndex = 0;

/** Argument defaults of the display set-pixel action. */
inline constexpr mc_number_t kDisplaySetPixelDefaultX = 0;
inline constexpr mc_number_t kDisplaySetPixelDefaultY = 0;
inline constexpr mc_number_t kDisplaySetPixelDefaultBrightness = 255;

namespace detail
{

/** The slot's value when present and non-nil, mirroring the TS `hasArg`. */
inline bool hasArg(Span<const Value> args, uint32_t slotId)
{
    return slotId < args.size() && !args[slotId].isNil();
}

/** The slot's numeric payload, or `fallback` when absent or non-numeric. */
inline mc_number_t numberArgOr(Span<const Value> args, uint32_t slotId, mc_number_t fallback)
{
    if (slotId < args.size() && args[slotId].isNumber())
    {
        return args[slotId].asNumber();
    }
    return fallback;
}

/**
 * Converts a pixel coordinate to the display port's u8 width. False when the
 * value is not an exact integer in 0..255: the simulated device discards such
 * writes, so they must not reach the port.
 */
inline bool pixelCoordToPort(mc_number_t value, uint8_t &out)
{
    if (!(value >= 0.0f && value <= 255.0f))
    {
        return false;
    }
    const uint8_t truncated = static_cast<uint8_t>(value);
    if (static_cast<mc_number_t>(truncated) != value)
    {
        return false;
    }
    out = truncated;
    return true;
}

/**
 * Converts a brightness to the port's u8 range, mirroring the wodal device's
 * clamp: non-finite values become 0; finite values truncate toward zero and
 * clamp to 0..255.
 */
inline uint8_t brightnessToPort(mc_number_t value)
{
    if (value != value || value - value != 0.0f)
    {
        return 0;
    }
    if (value <= 0.0f)
    {
        return 0;
    }
    if (value >= 255.0f)
    {
        return 255;
    }
    return static_cast<uint8_t>(value);
}

} // namespace detail

/**
 * Host sensor body: edge-triggered button A. Reports the released-to-pressed
 * edge by default or with the `pressed` modifier, and the pressed-to-released
 * edge with the `released` modifier. True only on the edge, not while the
 * button is held. Per-callsite state holds the previously observed button
 * level; the first evaluation after a page enter seeds the baseline without
 * an edge. `hostData` is the bound {@link DevicePorts}. Mirrors wodal
 * `actions/button-a.ts`.
 */
inline Value execButtonA(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    const bool current = ports.buttons->isPressed(kButtonAPortIndex);
    const bool hasPrevious = ctx.hasCallSiteState();
    const bool previous = hasPrevious && ctx.callSiteState().asBoolean();
    ctx.setCallSiteState(Value::boolean(current));
    if (!hasPrevious)
    {
        return kFalseValue;
    }
    const bool wantReleased = detail::hasArg(args, kButtonAReleasedArgSlot);
    const bool edge = wantReleased ? (previous && !current) : (!previous && current);
    return Value::boolean(edge);
}

/**
 * Page-activation hook of the button A sensor: drops the bound call site's
 * stored button level so transitions that happened while the page was
 * inactive are not reported.
 */
inline void buttonAPageEntered(void *hostData, ExecutionContext &ctx)
{
    static_cast<void>(hostData);
    ctx.clearCallSiteState();
}

/**
 * Host actuator body: set one LED pixel brightness. Optional x/y/brightness
 * arguments default to 0/0/255; the write crosses the display device port
 * unless a coordinate cannot cross its u8 width. `hostData` is the bound
 * {@link DevicePorts}. Mirrors wodal `actions/display-set-pixel.ts`.
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
    uint8_t portX = 0;
    uint8_t portY = 0;
    if (detail::pixelCoordToPort(x, portX) && detail::pixelCoordToPort(y, portY))
    {
        ports.display->setPixel(portX, portY, detail::brightnessToPort(brightness));
    }
    return kVoidValue;
}

/**
 * Async host actuator body: scroll text across the display. Reads the optional
 * text argument (defaulting to "hello" when absent), starts the scroll on the
 * display port at the current think time, and leaves `handle` for the port to
 * resolve when the animation completes; the calling fiber awaits it. `hostData`
 * is the bound {@link MicroBitV2DisplayScrollEnv}. Mirrors wodal
 * `actions/display-scroll.ts`.
 */
inline Status execScrollText(void *hostData, ExecutionContext &ctx, Span<const Value> args,
                             AsyncHandle handle)
{
    MicroBitV2DisplayScrollEnv &env = *static_cast<MicroBitV2DisplayScrollEnv *>(hostData);
    const char *bytes = kDisplayScrollDefaultText;
    uint32_t length = sizeof(kDisplayScrollDefaultText) - 1;
    if (kDisplayScrollTextArgSlot < args.size() && args[kDisplayScrollTextArgSlot].isString())
    {
        const char *argBytes = nullptr;
        uint32_t argLength = 0;
        if (env.heap->stringContent(args[kDisplayScrollTextArgSlot], argBytes, argLength))
        {
            bytes = argBytes;
            length = argLength;
        }
    }
    env.display->scrollText(reinterpret_cast<const uint8_t *>(bytes), length, kScrollDefaultDelayMs,
                            ctx.time, handle);
    return Status::ok();
}

/** Number of microbit-v2 host-action bindings the slice registers. */
inline constexpr uint32_t kMicroBitV2HostActionBindingCount = 3;

/**
 * Builds the microbit-v2 host-action binding table over `ports`, one entry per
 * action body. The async scroll body uses `scrollEnv` (its display port and
 * heap); pass null when the table will never dispatch a scroll. `ports` and
 * `scrollEnv` must outlive every dispatch through the table.
 */
inline std::array<HostActionBinding, kMicroBitV2HostActionBindingCount>
makeMicroBitV2HostActionBindings(DevicePorts &ports,
                                 MicroBitV2DisplayScrollEnv *scrollEnv = nullptr)
{
    return {{
        {MicroBitV2HostActions::ButtonA.actionId, &execButtonA, &buttonAPageEntered, &ports},
        {MicroBitV2HostActions::DisplaySetPixel.actionId, &execDisplaySetPixel, nullptr, &ports},
        {MicroBitV2HostActions::DisplayScroll.actionId, nullptr, nullptr, scrollEnv,
         &execScrollText},
    }};
}

} // namespace mindcraft
