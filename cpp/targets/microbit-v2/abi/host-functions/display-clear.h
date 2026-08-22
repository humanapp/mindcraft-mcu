#pragma once

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace wendoo
{

/**
 * Host function `MicroBitDisplay.clear`: cancels any held display lease and
 * blanks the matrix through the display port. Arg 0 is the display receiver; an
 * unrecognized receiver is a no-op. `hostData` is the bound {@link DevicePorts}.
 * Mirrors the `MicroBitDisplay.clear` body in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
inline Status execDisplayClear(void *hostData, Span<const Value> args, Value &result)
{
    DevicePorts &ports = *static_cast<DevicePorts *>(hostData);
    if (!args.empty() && detail::isReceiver(args[0], MicroBitV2TypeAtomId::MicroBitDisplay))
    {
        ports.display->clear();
    }
    result = kVoidValue;
    return Status::ok();
}

} // namespace wendoo
