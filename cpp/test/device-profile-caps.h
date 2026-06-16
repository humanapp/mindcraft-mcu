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

} // namespace mindcraft::test
