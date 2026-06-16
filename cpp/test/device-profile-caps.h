#pragma once

#include "core/runtime/device-profile-caps.h"
#include "targets/microbit-v2/abi/device-profile.h"

namespace mindcraft::test {

/**
 * The microbit-v2 caps the test suite runs every scheduler and standalone
 * machine under, so the harness exercises the same per-round budget and
 * resource limits the firmware uses. The device-profile cap parity gate holds
 * these equal to the WODAL device profile.
 */
inline constexpr DeviceProfileCaps kDeviceProfileCaps = kMicroBitV2DeviceProfileCaps;

/** Returns `caps` with its async-handle cap raised to `maxHandles`. */
inline constexpr DeviceProfileCaps withMaxHandles(DeviceProfileCaps caps, uint32_t maxHandles) {
  caps.maxHandles = maxHandles;
  return caps;
}

/**
 * The microbit-v2 caps with a positive async-handle cap, for tests that exercise
 * `HOST_CALL_ASYNC` / `AWAIT`. The microbit-v2 profile itself keeps `maxHandles`
 * at 0 until its first async capability ships; this variant only lifts that one
 * guard so the async dispatch path can allocate handles.
 */
inline constexpr DeviceProfileCaps kAsyncDeviceProfileCaps =
    withMaxHandles(kMicroBitV2DeviceProfileCaps, 16);

} // namespace mindcraft::test
