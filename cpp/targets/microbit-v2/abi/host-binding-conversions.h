#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/value.h"

namespace mindcraft
{

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

} // namespace mindcraft
