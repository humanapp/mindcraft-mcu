#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/button-index.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"

namespace wendoo
{

/**
 * Press-duration boundary in VM logical milliseconds: a release whose press
 * lasted at or above this derives a `long click`, a shorter press a `click`.
 * Mirrors LONG_CLICK_THRESHOLD_MS in
 * packages/wodal/src/targets/microbit-v2/wendoo/actions/button-sensor.ts.
 */
inline constexpr mc_number_t kButtonLongClickThresholdMs = 1000;

/**
 * Window in VM logical milliseconds within which a press following a click
 * derives a `double click`. Mirrors DOUBLE_CLICK_WINDOW_MS in the wodal source.
 */
inline constexpr mc_number_t kButtonDoubleClickWindowMs = 500;

/**
 * Positional arg slots of a button sensor, in the flattened call-definition
 * order of the wodal action source (bag(optional(choice(pressed, released,
 * click, double-click, long-click, held)))). At most one slot is present; an
 * absent modifier selects `pressed`.
 */
inline constexpr uint32_t kButtonPressedArgSlot = 0;
inline constexpr uint32_t kButtonReleasedArgSlot = 1;
inline constexpr uint32_t kButtonClickArgSlot = 2;
inline constexpr uint32_t kButtonDoubleClickArgSlot = 3;
inline constexpr uint32_t kButtonLongClickArgSlot = 4;
inline constexpr uint32_t kButtonHeldArgSlot = 5;

/** List indices of a button sensor's per-callsite derivation state. */
inline constexpr int32_t kButtonStatePrevPressedIndex = 0;
inline constexpr int32_t kButtonStatePressStartIndex = 1;
inline constexpr int32_t kButtonStateLastClickIndex = 2;
inline constexpr int32_t kButtonStatePendingClickIndex = 3;

/** Selects which polled input(s) define a button sensor's press level. */
enum class ButtonInput : uint8_t
{
    A,
    B,
    AB,
    Logo,
};

/**
 * Ambient capabilities the button-sensor bodies reach for: the button input
 * port they poll and the {@link heap}/{@link roots} backing each call site's
 * derivation-state list. Every pointer is non-owning and must outlive every
 * dispatch through the bindings.
 */
struct MicroBitV2ButtonSensorEnv
{
    /** Button input port the sensors poll. */
    ButtonInputPort *buttons = nullptr;
    /** Managed heap backing the per-callsite derivation-state list. */
    ManagedHeap *heap = nullptr;
    /** Collection root source for the derivation-state allocation. */
    GcRoots *roots = nullptr;
};

namespace detail
{

/** Reads the polled press level that defines `input`. */
inline bool readButtonLevel(ButtonInputPort &buttons, ButtonInput input)
{
    switch (input)
    {
    case ButtonInput::A:
        return buttons.isPressed(static_cast<uint8_t>(MicroBitButtonIndex::A));
    case ButtonInput::B:
        return buttons.isPressed(static_cast<uint8_t>(MicroBitButtonIndex::B));
    case ButtonInput::AB:
        return buttons.isPressed(static_cast<uint8_t>(MicroBitButtonIndex::A)) &&
               buttons.isPressed(static_cast<uint8_t>(MicroBitButtonIndex::B));
    case ButtonInput::Logo:
        return buttons.isPressed(static_cast<uint8_t>(MicroBitButtonIndex::Logo));
    }
    return false;
}

/**
 * Allocates a fresh derivation-state list `[prevPressed, pressStart, lastClick,
 * pendingClick]` seeded at the current press level, keeping it rooted across
 * the element appends. Returns false when the heap cannot back the list.
 */
inline bool createButtonState(MicroBitV2ButtonSensorEnv &env, bool pressed, mc_number_t now,
                              Value &out)
{
    Value listValue;
    if (!env.heap->newList(kNoTypeIdx, env.roots, listValue))
    {
        return false;
    }
    ManagedHeap::Pin pin(*env.heap, listValue);
    ListObject *obj = env.heap->list(listValue);
    if (!env.heap->listPush(obj, Value::boolean(pressed), env.roots) ||
        !env.heap->listPush(obj, Value::number(now), env.roots) ||
        !env.heap->listPush(obj, Value::number(0), env.roots) ||
        !env.heap->listPush(obj, Value::boolean(false), env.roots))
    {
        return false;
    }
    out = listValue;
    return true;
}

} // namespace detail

/**
 * Button sensor body: polls `input`'s press level and derives one button event
 * from the polled stream, selected by the present modifier slot (all absent
 * selects `pressed`). True only on the tick its event occurs; `held` is true on
 * every pressed tick. The first evaluation after a page enter seeds the
 * baseline at the current level without an edge. `hostData` is the bound
 * {@link MicroBitV2ButtonSensorEnv}; the per-callsite state is a four-element
 * list. Mirrors the wodal button-sensor oracle.
 */
inline Value execButtonSensor(MicroBitV2ButtonSensorEnv &env, ButtonInput input,
                              ExecutionContext &ctx, Span<const Value> args)
{
    const bool pressed = detail::readButtonLevel(*env.buttons, input);
    const mc_number_t now = ctx.time;

    Value stateValue;
    if (ctx.hasCallSiteState() && ctx.callSiteState().isList())
    {
        stateValue = ctx.callSiteState();
    }
    else
    {
        if (detail::createButtonState(env, pressed, now, stateValue))
        {
            ctx.setCallSiteState(stateValue);
        }
        else
        {
            ctx.clearCallSiteState();
        }
        return kFalseValue;
    }

    ListObject *obj = env.heap->list(stateValue);
    bool prevPressed = env.heap->listGet(obj, kButtonStatePrevPressedIndex).asBoolean();
    mc_number_t pressStart = env.heap->listGet(obj, kButtonStatePressStartIndex).asNumber();
    mc_number_t lastClick = env.heap->listGet(obj, kButtonStateLastClickIndex).asNumber();
    bool pendingClick = env.heap->listGet(obj, kButtonStatePendingClickIndex).asBoolean();

    bool evPressed = false;
    bool evReleased = false;
    bool evClick = false;
    bool evDouble = false;
    bool evLong = false;
    const bool held = pressed;
    const bool pressEdge = !prevPressed && pressed;
    const bool releaseEdge = prevPressed && !pressed;
    if (pressEdge)
    {
        evPressed = true;
        if (pendingClick && now - lastClick <= kButtonDoubleClickWindowMs)
        {
            evDouble = true;
            pendingClick = false;
        }
        pressStart = now;
    }
    else if (releaseEdge)
    {
        evReleased = true;
        if (now - pressStart >= kButtonLongClickThresholdMs)
        {
            evLong = true;
        }
        else
        {
            evClick = true;
            lastClick = now;
            pendingClick = true;
        }
    }
    prevPressed = pressed;

    env.heap->listSet(obj, kButtonStatePrevPressedIndex, Value::boolean(prevPressed));
    env.heap->listSet(obj, kButtonStatePressStartIndex, Value::number(pressStart));
    env.heap->listSet(obj, kButtonStateLastClickIndex, Value::number(lastClick));
    env.heap->listSet(obj, kButtonStatePendingClickIndex, Value::boolean(pendingClick));

    bool fired;
    if (detail::hasArg(args, kButtonPressedArgSlot))
    {
        fired = evPressed;
    }
    else if (detail::hasArg(args, kButtonReleasedArgSlot))
    {
        fired = evReleased;
    }
    else if (detail::hasArg(args, kButtonClickArgSlot))
    {
        fired = evClick;
    }
    else if (detail::hasArg(args, kButtonDoubleClickArgSlot))
    {
        fired = evDouble;
    }
    else if (detail::hasArg(args, kButtonLongClickArgSlot))
    {
        fired = evLong;
    }
    else if (detail::hasArg(args, kButtonHeldArgSlot))
    {
        fired = held;
    }
    else
    {
        fired = evPressed;
    }
    return Value::boolean(fired);
}

/** Button A sensor body. Mirrors wodal `buttonASensor`. */
inline Value execButtonA(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    return execButtonSensor(*static_cast<MicroBitV2ButtonSensorEnv *>(hostData), ButtonInput::A,
                            ctx, args);
}

/** Button B sensor body. Mirrors wodal `buttonBSensor`. */
inline Value execButtonB(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    return execButtonSensor(*static_cast<MicroBitV2ButtonSensorEnv *>(hostData), ButtonInput::B,
                            ctx, args);
}

/** Buttons A and B together sensor body. Mirrors wodal `buttonABSensor`. */
inline Value execButtonAB(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    return execButtonSensor(*static_cast<MicroBitV2ButtonSensorEnv *>(hostData), ButtonInput::AB,
                            ctx, args);
}

/** Logo touch sensor body. Mirrors wodal `buttonLogoSensor`. */
inline Value execButtonLogo(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    return execButtonSensor(*static_cast<MicroBitV2ButtonSensorEnv *>(hostData), ButtonInput::Logo,
                            ctx, args);
}

/**
 * Page-activation hook shared by the button sensors: drops the bound call
 * site's derivation state so the next evaluation re-seeds its baseline.
 */
inline void buttonSensorPageEntered(void *hostData, ExecutionContext &ctx)
{
    static_cast<void>(hostData);
    ctx.clearCallSiteState();
}

} // namespace wendoo
