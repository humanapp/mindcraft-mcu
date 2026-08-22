#pragma once

#include <cstdint>

#include "core/runtime/device-profile-caps.h"

namespace wendoo
{

/**
 * Numeric device-profile id the microbit-v2 firmware accepts. Mirrors the
 * `microbit-v2` entry of `WodalDeviceProfileNumericId` in
 * packages/wodal/src/wendoo/device-profile-id.ts. A decoded program whose
 * `profileId` is any other value is rejected at load with
 * `LoadError::UnsupportedDeviceProfile`.
 */
inline constexpr uint32_t kMicroBitV2NumericProfileId = 1;

/**
 * Scheduling and per-fiber resource caps for the microbit-v2 device profile.
 * Mirrors the cap fields of the `microbit-v2` entry of `WODAL_DEVICE_PROFILES`
 * in packages/wodal/src/wendoo/device-profile.ts; the two sides are held
 * equal by the device-profile cap parity gate. The host threads these into the
 * {@link FiberScheduler} constructor.
 */
inline constexpr DeviceProfileCaps kMicroBitV2DeviceProfileCaps{
    1000,  // defaultBudget
    40000, // hookBudget
    100,   // maxFibers
    256,   // maxStackSize
    256,   // maxLocalsSize
    64,    // maxFrameDepth
    16,    // maxHandlers
    8,     // maxHandles
};

} // namespace wendoo
