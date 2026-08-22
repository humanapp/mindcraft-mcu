#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace wendoo
{

namespace detail
{

/**
 * The accelerometer port for a call whose arg 0 is the accelerometer receiver,
 * or nullptr when the receiver is missing or of another type. `hostData` is the
 * bound {@link DevicePorts}.
 */
inline AccelerometerInputPort *accelerometerReceiver(void *hostData, Span<const Value> args)
{
    if (args.empty() || !isReceiver(args[0], MicroBitV2TypeAtomId::Accelerometer))
    {
        return nullptr;
    }
    return static_cast<DevicePorts *>(hostData)->accelerometer;
}

} // namespace detail

/**
 * Host function `Accelerometer.getX`: reads the X-axis acceleration in milli-g
 * through the accelerometer port. Arg 0 is the accelerometer receiver; an
 * unrecognized receiver reads 0. `hostData` is the bound {@link DevicePorts}.
 * Mirrors the `Accelerometer.getX` body in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
inline Status execAccelerometerGetX(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getX()) : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getY`: the Y-axis acceleration in milli-g. */
inline Status execAccelerometerGetY(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getY()) : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getZ`: the Z-axis acceleration in milli-g. */
inline Status execAccelerometerGetZ(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getZ()) : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getPitchRadians`: the pitch in radians. */
inline Status execAccelerometerGetPitchRadians(void *hostData, Span<const Value> args,
                                               Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? port->getPitchRadians() : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getRollRadians`: the roll in radians. */
inline Status execAccelerometerGetRollRadians(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? port->getRollRadians() : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getPitch`: the pitch in whole degrees. */
inline Status execAccelerometerGetPitch(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getPitch()) : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getRoll`: the roll in whole degrees. */
inline Status execAccelerometerGetRoll(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getRoll()) : 0);
    return Status::ok();
}

/** Host function `Accelerometer.getGesture`: the current gesture code. */
inline Status execAccelerometerGetGesture(void *hostData, Span<const Value> args, Value &result)
{
    AccelerometerInputPort *port = detail::accelerometerReceiver(hostData, args);
    result = Value::number(port ? static_cast<mc_number_t>(port->getGesture()) : 0);
    return Status::ok();
}

} // namespace wendoo
