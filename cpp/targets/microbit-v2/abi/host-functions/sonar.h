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

namespace wendoo
{

namespace detail
{

/**
 * The sonar port for a call whose arg 0 is the Sonar receiver, or nullptr when
 * the receiver is missing or of another type. `hostData` is the bound
 * {@link DevicePorts}.
 */
inline SonarPort *sonarReceiver(void *hostData, Span<const Value> args)
{
    if (args.empty() || !isReceiver(args[0], MicroBitV2TypeAtomId::Sonar))
    {
        return nullptr;
    }
    return static_cast<DevicePorts *>(hostData)->sonar;
}

/** The non-negative integer at arg `slot`, or 0 when the slot is missing or non-numeric. */
inline int sonarIntArg(Span<const Value> args, uint32_t slot)
{
    return slot < args.size() && args[slot].isNumber()
               ? static_cast<int>(toNonNegativeInteger(args[slot].asNumber()))
               : 0;
}

} // namespace detail

/**
 * Host function `Sonar.distance`: reads the cached distance in centimeters of the
 * sonar wired to the `trig`/`echo` pin arguments through the sonar port and pushes
 * it back. Arg 0 is the Sonar receiver, arg 1 the trigger pin, arg 2 the echo
 * pin; an unrecognized receiver reads 0. The first reference to a pin pair
 * registers that sonar with the background driver. `hostData` is the bound
 * {@link DevicePorts}. Mirrors the `Sonar.distance` host function in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
inline Status execSonarDistance(void *hostData, Span<const Value> args, Value &result)
{
    SonarPort *port = detail::sonarReceiver(hostData, args);
    const int trig = detail::sonarIntArg(args, 1);
    const int echo = detail::sonarIntArg(args, 2);
    result = Value::number(port ? static_cast<mc_number_t>(port->distance(trig, echo)) : 0);
    return Status::ok();
}

} // namespace wendoo
