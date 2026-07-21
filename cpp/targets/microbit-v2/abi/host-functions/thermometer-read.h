#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

namespace detail
{

/**
 * The thermometer port for a call whose arg 0 is the thermometer receiver, or
 * nullptr when the receiver is missing or of another type. `hostData` is the
 * bound {@link DevicePorts}.
 */
inline ThermometerInputPort *thermometerReceiver(void *hostData, Span<const Value> args)
{
    if (args.empty() || !isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitThermometer))
    {
        return nullptr;
    }
    return static_cast<DevicePorts *>(hostData)->thermometer;
}

} // namespace detail

/**
 * Host function `Thermometer.getTemperature`: reads the die temperature in whole
 * degrees Celsius (signed) through the thermometer port. Arg 0 is the
 * thermometer receiver; an unrecognized receiver reads 0. `hostData` is the
 * bound {@link DevicePorts}. Mirrors the `Thermometer.getTemperature` body in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execThermometerGetTemperature(void *hostData, Span<const Value> args, Value &result)
{
    ThermometerInputPort *port = detail::thermometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getTemperature()) : 0);
    return Status::ok();
}

} // namespace mindcraft
