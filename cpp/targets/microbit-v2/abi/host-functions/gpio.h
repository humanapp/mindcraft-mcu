#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/numeric.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

namespace detail
{

/**
 * The GPIO port for a call whose arg 0 is the GPIO receiver, or nullptr when the
 * receiver is missing or of another type. `hostData` is the bound
 * {@link DevicePorts}.
 */
inline GPIOPort *gpioReceiver(void *hostData, Span<const Value> args)
{
    if (args.empty() || !isReceiver(args[0], MicroBitV2TypeAtomId::GPIO))
    {
        return nullptr;
    }
    return static_cast<DevicePorts *>(hostData)->gpio;
}

/** The non-negative integer at arg `slot`, or 0 when the slot is missing or non-numeric. */
inline int gpioIntArg(Span<const Value> args, uint32_t slot)
{
    return slot < args.size() && args[slot].isNumber()
               ? static_cast<int>(toNonNegativeInteger(args[slot].asNumber()))
               : 0;
}

} // namespace detail

/**
 * Host function `GPIO.digitalRead`: reads the digital level of the `pin`
 * argument (0-20) through the GPIO port and pushes it back (0 low, 1 high). Arg
 * 0 is the GPIO receiver, arg 1 the pin; an unrecognized receiver reads 0.
 * `hostData` is the bound {@link DevicePorts}. Mirrors the `GPIO.digitalRead`
 * host function in packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execGpioDigitalRead(void *hostData, Span<const Value> args, Value &result)
{
    GPIOPort *port = detail::gpioReceiver(hostData, args);
    const int pin = detail::gpioIntArg(args, 1);
    result = Value::number(port ? static_cast<mc_number_t>(port->digitalRead(pin)) : 0);
    return Status::ok();
}

/**
 * Host function `GPIO.digitalWrite`: writes the `value` argument (0 low, nonzero
 * high) to the `pin` argument (0-20) through the GPIO port and pushes back the
 * status (0 on success). Arg 0 is the GPIO receiver, arg 1 the pin, arg 2 the
 * value; an unrecognized receiver pushes 0 without touching a pin. `hostData` is
 * the bound {@link DevicePorts}. Mirrors the `GPIO.digitalWrite` host function
 * in packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execGpioDigitalWrite(void *hostData, Span<const Value> args, Value &result)
{
    GPIOPort *port = detail::gpioReceiver(hostData, args);
    const int pin = detail::gpioIntArg(args, 1);
    const int value = detail::gpioIntArg(args, 2);
    result = Value::number(port ? static_cast<mc_number_t>(port->digitalWrite(pin, value)) : 0);
    return Status::ok();
}

/**
 * Host function `GPIO.setPull`: sets the pull mode (0 none, 1 up, 2 down) of the
 * `pin` argument (0-20) through the GPIO port and pushes back the status (0 on
 * success). Arg 0 is the GPIO receiver, arg 1 the pin, arg 2 the mode; an
 * unrecognized receiver pushes 0 without touching a pin. `hostData` is the bound
 * {@link DevicePorts}. Mirrors the `GPIO.setPull` host function in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execGpioSetPull(void *hostData, Span<const Value> args, Value &result)
{
    GPIOPort *port = detail::gpioReceiver(hostData, args);
    const int pin = detail::gpioIntArg(args, 1);
    const int mode = detail::gpioIntArg(args, 2);
    result = Value::number(port ? static_cast<mc_number_t>(port->setPull(pin, mode)) : 0);
    return Status::ok();
}

/**
 * Host function `GPIO.servoWrite`: writes a servo `angle` in degrees (0-180) to
 * the `pin` argument (0-20) through the GPIO port and pushes back the status (0
 * on success). Arg 0 is the GPIO receiver, arg 1 the pin, arg 2 the angle; an
 * unrecognized receiver pushes 0 without touching a pin. `hostData` is the bound
 * {@link DevicePorts}. Mirrors the `GPIO.servoWrite` host function in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execGpioServoWrite(void *hostData, Span<const Value> args, Value &result)
{
    GPIOPort *port = detail::gpioReceiver(hostData, args);
    const int pin = detail::gpioIntArg(args, 1);
    const int angle = detail::gpioIntArg(args, 2);
    result = Value::number(port ? static_cast<mc_number_t>(port->setServo(pin, angle)) : 0);
    return Status::ok();
}

} // namespace mindcraft
