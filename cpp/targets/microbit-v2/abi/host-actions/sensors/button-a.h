#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"

namespace mindcraft
{

/**
 * Positional arg slots of the button A sensor, mirroring the flattened
 * call-definition arg slots of the wodal action source
 * (packages/wodal/src/targets/microbit-v2/mindcraft/actions/button-a.ts). Slot
 * order is the call spec's declaration order and is wire-stable with the
 * compiler's emitted arg buffers.
 */
inline constexpr uint32_t kButtonAPressedArgSlot = 0;
inline constexpr uint32_t kButtonAReleasedArgSlot = 1;

/** Button-port index of button A. */
inline constexpr uint8_t kButtonAPortIndex = 0;

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

} // namespace mindcraft
