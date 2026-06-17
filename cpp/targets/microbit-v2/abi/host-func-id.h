#pragma once

#include <cstdint>

namespace mindcraft
{

/**
 * Stable numeric funcIds for the microbit-v2 host functions: the native
 * struct methods and the sensor/actuator function entries. Mirrors the
 * MicroBitV2HostFuncId enum in
 * packages/wodal/src/targets/microbit-v2/mindcraft/tile-ids.ts. `HOST_CALL`
 * dispatches by these values and serialized programs record them verbatim,
 * so the values are wire-stable: never renumber or reuse a value; append new
 * members at the next free id. All values are at or above core's
 * `TARGET_FUNC_ID_BASE`.
 */
enum class MicroBitV2HostFuncId : uint32_t
{
    DisplaySetPixelValue = 1024,
    DisplayGetPixelValue = 1025,
    DisplayClear = 1026,
    ButtonIsPressed = 1027,
    TouchButtonIsPressed = 1028,
    TouchButtonGetThreshold = 1029,
    TouchButtonSetThreshold = 1030,
    TouchButtonGetValue = 1031,
    TouchButtonSetValue = 1032,
    SensorButtonA = 1033,
    ActuatorDisplaySetPixel = 1034,
    ActuatorDisplayScroll = 1035,
};

/**
 * Number of declared {@link MicroBitV2HostFuncId} members; ids are dense
 * from 1024.
 */
inline constexpr uint32_t kMicroBitV2HostFuncIdCount = 11;

} // namespace mindcraft
