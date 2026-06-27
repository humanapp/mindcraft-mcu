#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/error-code.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/numeric.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

/**
 * Positional arg slots of the `I2C.readBuffer` host function: arg 0 is the I2C
 * receiver, arg 1 the 7-bit device address, arg 2 the byte count to read.
 */
inline constexpr uint32_t kI2CReadAddressArgSlot = 1;
inline constexpr uint32_t kI2CReadLengthArgSlot = 2;

/**
 * The I2C port, managed heap, and collection roots an `I2C.readBuffer` body
 * reaches: the port to perform the bus read, and the heap plus roots to allocate
 * the managed `Buffer` it returns. The caller fills all three before the
 * binding's first dispatch.
 */
struct MicroBitV2I2CReadEnv
{
    I2CPort *port;
    ManagedHeap *heap;
    GcRoots *roots;
};

/**
 * Host function `I2C.readBuffer`: read the `length` argument's bytes from the
 * 7-bit `address` argument in one complete START/STOP transaction through the
 * I2C port, and push back a runtime-allocated managed `Buffer` holding the bytes
 * read. Arg 0 is the I2C receiver, arg 1 the address, arg 2 the byte count. An
 * unrecognized receiver, a no-device read, or a bus error pushes an empty
 * `Buffer`. A heap allocation failure faults the call. `hostData` is the bound
 * {@link MicroBitV2I2CReadEnv}. Mirrors the `I2C.readBuffer` host function in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execI2CReadBuffer(void *hostData, Span<const Value> args, Value &result)
{
    MicroBitV2I2CReadEnv &env = *static_cast<MicroBitV2I2CReadEnv *>(hostData);
    if (args.empty() || !detail::isReceiver(args[0], MicroBitV2TypeAtomId::I2C))
    {
        return env.heap->newBuffer(nullptr, 0, env.roots, result)
                   ? Status::ok()
                   : Status::fail(ErrorCode::StackOverflow);
    }

    const uint16_t address = static_cast<uint16_t>(
        kI2CReadAddressArgSlot < args.size() && args[kI2CReadAddressArgSlot].isNumber()
            ? toNonNegativeInteger(args[kI2CReadAddressArgSlot].asNumber())
            : 0);
    const uint32_t length =
        kI2CReadLengthArgSlot < args.size() && args[kI2CReadLengthArgSlot].isNumber()
            ? toNonNegativeInteger(args[kI2CReadLengthArgSlot].asNumber())
            : 0;

    Value out;
    uint8_t *dst = nullptr;
    if (!env.heap->allocBuffer(length, env.roots, out, dst))
    {
        return Status::fail(ErrorCode::StackOverflow);
    }
    if (env.port->read(address, dst, static_cast<int>(length)) != 0)
    {
        // No-device or bus error: an empty Buffer (the length-sized buffer is
        // discarded). The error allocation may collect it, which is harmless.
        return env.heap->newBuffer(nullptr, 0, env.roots, result)
                   ? Status::ok()
                   : Status::fail(ErrorCode::StackOverflow);
    }
    result = out;
    return Status::ok();
}

} // namespace mindcraft
