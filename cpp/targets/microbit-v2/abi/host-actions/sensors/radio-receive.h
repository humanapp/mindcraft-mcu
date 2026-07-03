#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"

namespace mindcraft
{

/**
 * The radio port plus the heap and roots the typed receive sensors use to
 * allocate their managed string results, output-key strings, and output
 * rule-variable storage. Every pointer is non-owning, must be bound before the
 * first dispatch, and must outlive every dispatch.
 */
struct MicroBitV2RadioSensorEnv
{
    RadioPort *radio = nullptr;
    ManagedHeap *heap = nullptr;
    GcRoots *roots = nullptr;
};

/** Rule-variable key of the number receive sensor's `value` output tile. */
inline constexpr char kRadioReceiveNumberValueOutputKey[] = "__out.number:<number>.value";

/** Rule-variable key of the string receive sensor's `value` output tile. */
inline constexpr char kRadioReceiveStringValueOutputKey[] = "__out.string:<string>.value";

/** Rule-variable key of the buffer receive sensor's `value` output tile. */
inline constexpr char kRadioReceiveBufferValueOutputKey[] = "__out.buffer:<buffer>.value";

/** Rule-variable key of the receive sensors' shared `signal strength` output tile. */
inline constexpr char kRadioReceiveRssiOutputKey[] = "__out.number:<number>.rssi";

/** Packet kind a typed radio receive sensor delivers. */
enum class RadioReceiveKind : uint8_t
{
    Number,
    String,
    Buffer,
};

namespace detail
{

/** True when `type` is a packet of the sensor's `kind` (NUMBER/DOUBLE, STRING, or BUFFER). */
inline bool radioTypeMatches(RadioReceiveKind kind, int type)
{
    switch (kind)
    {
    case RadioReceiveKind::Number:
        return type == 0 || type == 4;
    case RadioReceiveKind::String:
        return type == 2;
    case RadioReceiveKind::Buffer:
        return type == 3;
    }
    return false;
}

/**
 * Writes one receive-sensor output rule variable on the in-scope rule:
 * allocates the managed key string and stores `value` under it. An allocation
 * failure drops the write.
 */
inline void writeReceiveOutput(MicroBitV2RadioSensorEnv &env, ExecutionContext &ctx,
                               const char *key, uint32_t keyLength, const Value &value)
{
    Value name;
    if (!env.heap->newString(key, keyLength, env.roots, name))
    {
        return;
    }
    setRuleVariable(ctx, *env.heap, env.roots, name, value);
}

/** Builds the sensor's result value for a matched packet, per the sensor's kind. */
inline bool radioReceiveResult(MicroBitV2RadioSensorEnv &env, RadioReceiveKind kind,
                               const RadioPacketView &packet, Value &result)
{
    switch (kind)
    {
    case RadioReceiveKind::Number:
        result = Value::number(packet.value);
        return true;
    case RadioReceiveKind::String:
        return env.heap->newString(reinterpret_cast<const char *>(packet.text), packet.textLen,
                                   env.roots, result);
    case RadioReceiveKind::Buffer:
        return env.heap->newBuffer(packet.bytes, packet.bytesLen, env.roots, result);
    }
    return false;
}

/** The `value` output-tile rule-variable key for the sensor's kind. */
inline const char *radioReceiveValueOutputKey(RadioReceiveKind kind, uint32_t &lengthOut)
{
    switch (kind)
    {
    case RadioReceiveKind::Number:
        lengthOut = sizeof(kRadioReceiveNumberValueOutputKey) - 1;
        return kRadioReceiveNumberValueOutputKey;
    case RadioReceiveKind::String:
        lengthOut = sizeof(kRadioReceiveStringValueOutputKey) - 1;
        return kRadioReceiveStringValueOutputKey;
    case RadioReceiveKind::Buffer:
        lengthOut = sizeof(kRadioReceiveBufferValueOutputKey) - 1;
        return kRadioReceiveBufferValueOutputKey;
    }
    lengthOut = 0;
    return nullptr;
}

} // namespace detail

/**
 * Typed radio receive sensor body: delivers the oldest still-unread packet of
 * its kind from the receive ring (NUMBER/DOUBLE for the number sensor, STRING
 * for the string sensor, BUFFER for the buffer sensor), advancing this call
 * site's own cursor by one. The delivered value -- including a 0, an empty
 * string, or an empty buffer -- is the result; genuine absence (no matching
 * packet this think, or the first evaluation after a page enter) returns nil.
 * A delivered packet also writes the sensor's output-tile rule variables on
 * the in-scope rule: its typed `value` output and the shared number `signal
 * strength` (rssi) output. The per-callsite cursor is a plain number; a page
 * enter arms it to the ring head. Mirrors the wodal radio-receive oracle.
 */
inline Value execRadioReceiveSensor(MicroBitV2RadioSensorEnv &env, RadioReceiveKind kind,
                                    ExecutionContext &ctx, Span<const Value> args)
{
    static_cast<void>(args);
    RadioPort *radio = env.radio;
    if (radio == nullptr)
    {
        return kNilValue;
    }
    if (!ctx.hasCallSiteState() || !ctx.callSiteState().isNumber())
    {
        // First evaluation after a page enter arms the cursor to the ring head.
        ctx.setCallSiteState(Value::number(static_cast<mc_number_t>(radio->headSequence())));
        return kNilValue;
    }
    const int cursor = static_cast<int>(ctx.callSiteState().asNumber());
    for (uint32_t i = 0; i < radio->ringSize(); i++)
    {
        const RadioPacketView &packet = radio->ringAt(i);
        if (packet.seq <= cursor)
        {
            continue;
        }
        if (!detail::radioTypeMatches(kind, packet.type))
        {
            continue;
        }
        ctx.setCallSiteState(Value::number(static_cast<mc_number_t>(packet.seq)));
        Value result;
        if (!detail::radioReceiveResult(env, kind, packet, result))
        {
            return kNilValue;
        }
        // Pin the fresh result across the output-key allocations below.
        ManagedHeap::Pin pinResult(*env.heap, result);
        uint32_t valueKeyLength = 0;
        const char *valueKey = detail::radioReceiveValueOutputKey(kind, valueKeyLength);
        detail::writeReceiveOutput(env, ctx, valueKey, valueKeyLength, result);
        detail::writeReceiveOutput(env, ctx, kRadioReceiveRssiOutputKey,
                                   sizeof(kRadioReceiveRssiOutputKey) - 1,
                                   Value::number(static_cast<mc_number_t>(packet.rssi)));
        return result;
    }
    return kNilValue;
}

/** Number receive sensor body. Mirrors wodal `radioReceiveNumberSensor`. */
inline Value execRadioReceiveNumber(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    if (hostData == nullptr)
    {
        return kNilValue;
    }
    return execRadioReceiveSensor(*static_cast<MicroBitV2RadioSensorEnv *>(hostData),
                                  RadioReceiveKind::Number, ctx, args);
}

/** String receive sensor body. Mirrors wodal `radioReceiveStringSensor`. */
inline Value execRadioReceiveString(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    if (hostData == nullptr)
    {
        return kNilValue;
    }
    return execRadioReceiveSensor(*static_cast<MicroBitV2RadioSensorEnv *>(hostData),
                                  RadioReceiveKind::String, ctx, args);
}

/** Buffer receive sensor body. Mirrors wodal `radioReceiveBufferSensor`. */
inline Value execRadioReceiveBuffer(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    if (hostData == nullptr)
    {
        return kNilValue;
    }
    return execRadioReceiveSensor(*static_cast<MicroBitV2RadioSensorEnv *>(hostData),
                                  RadioReceiveKind::Buffer, ctx, args);
}

/** Page-activation hook: drops the bound call site's cursor so it re-arms to the ring head. */
inline void radioReceivePageEntered(void *hostData, ExecutionContext &ctx)
{
    static_cast<void>(hostData);
    ctx.clearCallSiteState();
}

} // namespace mindcraft
