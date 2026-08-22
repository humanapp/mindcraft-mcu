#pragma once

#include <cstdint>

#include "codal/accelerometer-gesture.h"
#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"

namespace wendoo
{

/**
 * Positional arg slots of the gesture sensor, in the flattened call-definition
 * order of the wodal action source (bag(optional(choice(shake, tilt-up,
 * tilt-down, tilt-left, tilt-right, face-up, face-down, freefall)))). At most one
 * slot is present; an absent modifier selects shake.
 */
inline constexpr uint32_t kGestureShakeArgSlot = 0;
inline constexpr uint32_t kGestureTiltUpArgSlot = 1;
inline constexpr uint32_t kGestureTiltDownArgSlot = 2;
inline constexpr uint32_t kGestureTiltLeftArgSlot = 3;
inline constexpr uint32_t kGestureTiltRightArgSlot = 4;
inline constexpr uint32_t kGestureFaceUpArgSlot = 5;
inline constexpr uint32_t kGestureFaceDownArgSlot = 6;
inline constexpr uint32_t kGestureFreefallArgSlot = 7;

namespace detail
{

/** The gesture code the present modifier matches; an absent modifier matches shake. */
inline AccelerometerGesture selectGesture(Span<const Value> args)
{
    if (hasArg(args, kGestureShakeArgSlot))
    {
        return AccelerometerGesture::Shake;
    }
    if (hasArg(args, kGestureTiltUpArgSlot))
    {
        return AccelerometerGesture::TiltUp;
    }
    if (hasArg(args, kGestureTiltDownArgSlot))
    {
        return AccelerometerGesture::TiltDown;
    }
    if (hasArg(args, kGestureTiltLeftArgSlot))
    {
        return AccelerometerGesture::TiltLeft;
    }
    if (hasArg(args, kGestureTiltRightArgSlot))
    {
        return AccelerometerGesture::TiltRight;
    }
    if (hasArg(args, kGestureFaceUpArgSlot))
    {
        return AccelerometerGesture::FaceUp;
    }
    if (hasArg(args, kGestureFaceDownArgSlot))
    {
        return AccelerometerGesture::FaceDown;
    }
    if (hasArg(args, kGestureFreefallArgSlot))
    {
        return AccelerometerGesture::Freefall;
    }
    return AccelerometerGesture::Shake;
}

} // namespace detail

/**
 * Gesture sensor body: polls the current gesture code and is true while it equals
 * the gesture the present modifier slot selects (all absent selects shake). A
 * pure level compare with no per-callsite state. `hostData` is the bound
 * {@link DevicePorts}. Mirrors the wodal gesture-sensor oracle.
 */
inline Value execGestureSensor(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(ctx);
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    const uint16_t code = ports.accelerometer->getGesture();
    return Value::boolean(code == static_cast<uint16_t>(detail::selectGesture(args)));
}

} // namespace wendoo
