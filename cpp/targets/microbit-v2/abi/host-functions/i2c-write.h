#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/buffer-value.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/numeric.h"
#include "core/runtime/program.h"
#include "core/runtime/result.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

/**
 * Positional arg slots of the `I2C.writeBuffer` host function: arg 0 is the I2C
 * receiver, arg 1 the 7-bit device address, arg 2 the `Buffer` to write.
 */
inline constexpr uint32_t kI2CWriteAddressArgSlot = 1;
inline constexpr uint32_t kI2CWriteDataArgSlot = 2;

/**
 * The I2C port, managed heap, and program image an `I2C.writeBuffer` body
 * reaches: the port to perform the bus write, the heap to resolve a managed
 * (runtime-allocated) `Buffer` argument, and the program to resolve a borrowed
 * (constant) `Buffer` argument. The caller fills all three before the binding's
 * first dispatch.
 */
struct MicroBitV2I2CWriteEnv
{
    I2CPort *port;
    ManagedHeap *heap;
    const ProgramImage *program;
};

/**
 * Host function `I2C.writeBuffer`: write the `Buffer` argument's bytes to the
 * 7-bit `address` argument in one complete START/STOP transaction through the
 * I2C port, and push back the bus status (0 on success). Arg 0 is the I2C
 * receiver, arg 1 the address, arg 2 the `Buffer` (a missing or non-buffer arg
 * writes zero bytes). An unrecognized receiver pushes 0 without touching the
 * bus. `hostData` is the bound {@link MicroBitV2I2CWriteEnv}. Mirrors the
 * `I2C.writeBuffer` host function in
 * packages/wodal/src/targets/microbit-v2/mindcraft/module.ts.
 */
inline Status execI2CWriteBuffer(void *hostData, Span<const Value> args, Value &result)
{
    MicroBitV2I2CWriteEnv &env = *static_cast<MicroBitV2I2CWriteEnv *>(hostData);
    if (args.empty() || !detail::isReceiver(args[0], MicroBitV2TypeAtomId::I2C))
    {
        result = Value::number(0);
        return Status::ok();
    }

    const uint16_t address = static_cast<uint16_t>(
        kI2CWriteAddressArgSlot < args.size() && args[kI2CWriteAddressArgSlot].isNumber()
            ? toNonNegativeInteger(args[kI2CWriteAddressArgSlot].asNumber())
            : 0);

    const Value data =
        kI2CWriteDataArgSlot < args.size() ? args[kI2CWriteDataArgSlot] : Value::nil();
    const uint8_t *bytes = nullptr;
    uint32_t length = 0;
    if (data.isBuffer())
    {
        if (data.isManagedBuffer())
        {
            if (env.heap == nullptr || !env.heap->bufferContent(data, bytes, length))
            {
                bytes = nullptr;
                length = 0;
            }
        }
        else
        {
            const ByteSpan span = bufferBytes(*env.program, data);
            bytes = span.data();
            length = static_cast<uint32_t>(span.size());
        }
    }

    const int status = env.port->write(address, bytes, static_cast<int>(length));
    result = Value::number(static_cast<mc_number_t>(status));
    return Status::ok();
}

} // namespace mindcraft
