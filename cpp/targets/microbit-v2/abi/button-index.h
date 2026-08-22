#pragma once

#include <cstdint>

namespace wendoo
{

/**
 * Port indices the micro:bit v2 passes to {@link ButtonInputPort::isPressed}:
 * button A is 0, button B is 1, and the capacitive touch logo is 2. These are
 * the board's index assignments for the abstract button port
 * (cpp/codal/device-port.h).
 */
enum class MicroBitButtonIndex : uint8_t
{
    A = 0,
    B = 1,
    Logo = 2,
};

} // namespace wendoo
