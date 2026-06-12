#pragma once

#include <cstdint>

#include "core/runtime/core-host-actions.h"
#include "targets/microbit-v2/abi/host-func-id.h"

namespace mindcraft
{

/**
 * Identity records of the microbit-v2 sensors and actuators, one per host
 * action. Mirrors the numeric ids of the MicroBitV2HostActions table in
 * packages/wodal/src/targets/microbit-v2/mindcraft/tile-ids.ts; the records'
 * string keys are build-time identities and are not mirrored. Action ids are
 * at or above core's `TARGET_ACTION_ID_BASE` and are wire-stable: never
 * renumber or reuse one; append new records at the next free action id.
 */
namespace MicroBitV2HostActions
{
/** Sensor: edge-triggered button A press or release. */
inline constexpr HostActionIds ButtonA{1024,
                                       static_cast<uint32_t>(MicroBitV2HostFuncId::SensorButtonA)};

/** Actuator: set a single LED pixel brightness on the 5x5 display. */
inline constexpr HostActionIds DisplaySetPixel{
    1025, static_cast<uint32_t>(MicroBitV2HostFuncId::ActuatorDisplaySetPixel)};
} // namespace MicroBitV2HostActions

/**
 * All microbit-v2 host-action records, in action-id order; ids are dense
 * from 1024.
 */
inline constexpr HostActionIds kMicroBitV2HostActions[] = {
    MicroBitV2HostActions::ButtonA,
    MicroBitV2HostActions::DisplaySetPixel,
};

} // namespace mindcraft
