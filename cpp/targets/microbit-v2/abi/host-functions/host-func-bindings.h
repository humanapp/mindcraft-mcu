#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/host-function.h"
#include "targets/microbit-v2/abi/host-actions/actuators/display-draw.h"
#include "targets/microbit-v2/abi/host-func-id.h"
#include "targets/microbit-v2/abi/host-functions/accelerometer-read.h"
#include "targets/microbit-v2/abi/host-functions/button-is-pressed.h"
#include "targets/microbit-v2/abi/host-functions/display-draw-image.h"
#include "targets/microbit-v2/abi/host-functions/display-set-pixel-value.h"
#include "targets/microbit-v2/abi/host-functions/gpio.h"
#include "targets/microbit-v2/abi/host-functions/i2c-read.h"
#include "targets/microbit-v2/abi/host-functions/i2c-write.h"
#include "targets/microbit-v2/abi/host-functions/sonar.h"

namespace mindcraft
{

/** Number of microbit-v2 target host-function bindings the slice registers. */
inline constexpr uint32_t kMicroBitV2HostFuncBindingCount = 19;

/**
 * Builds the microbit-v2 target host-function binding table over `ports`, one
 * entry per body. `ButtonIsPressed` and `TouchButtonIsPressed` share one body
 * (the receiver discriminator selects the input); the accelerometer reads each
 * bind a distinct body over the single accelerometer port. The async
 * `DisplayDrawImage` body uses `drawEnv` (its display port, heap, and program);
 * the `I2CWriteBuffer` body uses `i2cWriteEnv` (its I2C port, heap, and
 * program); the `I2CReadBuffer` body uses `i2cReadEnv` (its I2C port, heap, and
 * roots); the four `Gpio*` bodies each bind over the GPIO port in `ports`; the
 * `SonarDistance` body binds over the sonar port in `ports`. Pass null for an env
 * when the table will never dispatch its body. `ports` and any supplied env must
 * outlive every dispatch through the table.
 */
inline std::array<TargetHostFuncBinding, kMicroBitV2HostFuncBindingCount>
makeMicroBitV2HostFuncBindings(DevicePorts &ports, MicroBitV2DrawImageEnv *drawEnv = nullptr,
                               MicroBitV2I2CWriteEnv *i2cWriteEnv = nullptr,
                               MicroBitV2I2CReadEnv *i2cReadEnv = nullptr)
{
    return {{
        {static_cast<uint32_t>(MicroBitV2HostFuncId::ButtonIsPressed), &execButtonIsPressed,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::TouchButtonIsPressed), &execButtonIsPressed,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::DisplaySetPixelValue),
         &execDisplaySetPixelValue, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetX), &execAccelerometerGetX,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetY), &execAccelerometerGetY,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetZ), &execAccelerometerGetZ,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetPitchRadians),
         &execAccelerometerGetPitchRadians, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetRollRadians),
         &execAccelerometerGetRollRadians, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetPitch),
         &execAccelerometerGetPitch, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetRoll),
         &execAccelerometerGetRoll, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::AccelerometerGetGesture),
         &execAccelerometerGetGesture, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::DisplayDrawImage), nullptr, drawEnv,
         &execDrawImageHostFn},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::I2CWriteBuffer), &execI2CWriteBuffer,
         i2cWriteEnv},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::I2CReadBuffer), &execI2CReadBuffer,
         i2cReadEnv},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::GpioDigitalRead), &execGpioDigitalRead,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::GpioDigitalWrite), &execGpioDigitalWrite,
         &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::GpioSetPull), &execGpioSetPull, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::GpioServoWrite), &execGpioServoWrite, &ports},
        {static_cast<uint32_t>(MicroBitV2HostFuncId::SonarDistance), &execSonarDistance, &ports},
    }};
}

} // namespace mindcraft
