#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "codal/radio-wire.h"
#include "core/platform/span.h"
#include "core/runtime/error-code.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/numeric.h"
#include "core/runtime/result.h"
#include "core/runtime/type-registry.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"
#include "targets/microbit-v2/abi/host-functions/native-receiver.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace wendoo
{

/**
 * Field ids of the `RadioPacket` value struct, in declaration order. Mirrors
 * RadioPacketField in packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
enum class RadioPacketField : uint32_t
{
    Seq = 0,
    Type = 1,
    Value = 2,
    Name = 3,
    Text = 4,
    Buffer = 5,
    Rssi = 6,
    Serial = 7,
    Time = 8,
};

/**
 * The radio port and managed heap a radio send / config host function reaches.
 * The heap resolves managed or borrowed string / buffer arguments; config and
 * numeric sends ignore it. The caller fills both before the first dispatch.
 */
struct MicroBitV2RadioEnv
{
    RadioPort *radio;
    ManagedHeap *heap;
};

/**
 * The radio port, heap, roots, and type registry the `Radio.receive` drain-all
 * body reaches: the port for the ring, the heap plus roots to allocate the
 * returned managed `RadioPacket[]`, and the registry to resolve the
 * `RadioPacket` / `RadioPacketList` type-atoms to their program type indices.
 */
struct MicroBitV2RadioReceiveEnv
{
    RadioPort *radio;
    ManagedHeap *heap;
    GcRoots *roots;
    const TypeRegistry *types;
};

namespace detail
{

/** The radio port when arg 0 is the Radio receiver, else nullptr. */
inline RadioPort *radioReceiver(MicroBitV2RadioEnv &env, Span<const Value> args)
{
    if (args.empty() || !isReceiver(args[0], MicroBitV2TypeAtomId::Radio))
    {
        return nullptr;
    }
    return env.radio;
}

/** Reads a string argument's bytes (managed or borrowed), or an empty span. */
inline void radioStringArg(MicroBitV2RadioEnv &env, Span<const Value> args, uint32_t slot,
                           const uint8_t *&bytes, uint32_t &length)
{
    const char *chars = nullptr;
    uint32_t len = 0;
    if (slot < args.size() && args[slot].isString() &&
        env.heap->stringContent(args[slot], chars, len))
    {
        bytes = reinterpret_cast<const uint8_t *>(chars);
        length = len;
        return;
    }
    bytes = nullptr;
    length = 0;
}

/** Reads a buffer argument's bytes (managed or borrowed), or an empty span. */
inline void radioBufferArg(MicroBitV2RadioEnv &env, Span<const Value> args, uint32_t slot,
                           const uint8_t *&bytes, uint32_t &length)
{
    const uint8_t *raw = nullptr;
    uint32_t len = 0;
    if (slot < args.size() && args[slot].isBuffer() &&
        env.heap->bufferContent(args[slot], raw, len))
    {
        bytes = raw;
        length = len;
        return;
    }
    bytes = nullptr;
    length = 0;
}

} // namespace detail

/** Host function `Radio.sendNumber`: send a NUMBER (integer) / DOUBLE (non-integer) packet. */
inline Status execRadioSendNumber(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        const mc_number_t value = detail::numberArgOr(args, 1, 0);
        RadioSendView view{};
        view.type = radioNumberIsInteger(value) ? static_cast<int>(RadioPacketType::Number)
                                                : static_cast<int>(RadioPacketType::Double);
        view.group = radio->group();
        view.value = value;
        radio->send(view);
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.sendString`: send a STRING packet. */
inline Status execRadioSendString(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        RadioSendView view{};
        view.type = static_cast<int>(RadioPacketType::String);
        view.group = radio->group();
        detail::radioStringArg(env, args, 1, view.text, view.textLen);
        radio->send(view);
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.sendValue`: send a VALUE (integer) / DOUBLE_VALUE (non-integer) name+number
 * packet. */
inline Status execRadioSendValue(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        const mc_number_t value = detail::numberArgOr(args, 2, 0);
        RadioSendView view{};
        view.type = radioNumberIsInteger(value) ? static_cast<int>(RadioPacketType::Value)
                                                : static_cast<int>(RadioPacketType::DoubleValue);
        view.group = radio->group();
        view.value = value;
        detail::radioStringArg(env, args, 1, view.name, view.nameLen);
        radio->send(view);
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.sendBuffer`: send a BUFFER packet. */
inline Status execRadioSendBuffer(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        RadioSendView view{};
        view.type = static_cast<int>(RadioPacketType::Buffer);
        view.group = radio->group();
        detail::radioBufferArg(env, args, 1, view.bytes, view.bytesLen);
        radio->send(view);
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.sendRawBuffer`: send a raw datagram (no MakeCode prefix). */
inline Status execRadioSendRawBuffer(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        RadioSendView view{};
        view.type = kRadioRawPacketType;
        view.group = radio->group();
        detail::radioBufferArg(env, args, 1, view.bytes, view.bytesLen);
        radio->send(view);
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.setGroup`: set the radio group (0-255). */
inline Status execRadioSetGroup(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        radio->setGroup(static_cast<int>(detail::numberArgOr(args, 1, 0)));
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.setTransmitPower`: set the transmit power level (0-7). */
inline Status execRadioSetTransmitPower(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        radio->setTransmitPower(static_cast<int>(detail::numberArgOr(args, 1, 0)));
    }
    result = kVoidValue;
    return Status::ok();
}

/** Host function `Radio.setFrequencyBand`: set the frequency band (0-83). */
inline Status execRadioSetFrequencyBand(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kVoidValue;
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    if (radio != nullptr)
    {
        radio->setFrequencyBand(static_cast<int>(detail::numberArgOr(args, 1, 0)));
    }
    result = kVoidValue;
    return Status::ok();
}

namespace detail
{

/** Builds a `RadioPacket` value struct for `packet`, pinned, into `out`. Returns false on heap
 * exhaustion. */
inline bool buildRadioPacketStruct(MicroBitV2RadioReceiveEnv &env, uint32_t packetTypeIdx,
                                   const RadioPacketView &packet, Value &out)
{
    Value nameV;
    Value textV;
    Value bufferV;
    if (!env.heap->newString(reinterpret_cast<const char *>(packet.name), packet.nameLen, env.roots,
                             nameV))
    {
        return false;
    }
    ManagedHeap::Pin namePin(*env.heap, nameV);
    if (!env.heap->newString(reinterpret_cast<const char *>(packet.text), packet.textLen, env.roots,
                             textV))
    {
        return false;
    }
    ManagedHeap::Pin textPin(*env.heap, textV);
    if (!env.heap->newBuffer(packet.bytes, packet.bytesLen, env.roots, bufferV))
    {
        return false;
    }
    ManagedHeap::Pin bufferPin(*env.heap, bufferV);
    if (!env.heap->newStruct(packetTypeIdx, 9, env.roots, out))
    {
        return false;
    }
    StructObject *obj = env.heap->structOf(out);
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Seq),
                        Value::number(static_cast<mc_number_t>(packet.seq)));
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Type),
                        Value::number(static_cast<mc_number_t>(packet.type)));
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Value),
                        Value::number(packet.value));
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Name), nameV);
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Text), textV);
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Buffer), bufferV);
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Rssi),
                        Value::number(static_cast<mc_number_t>(packet.rssi)));
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Serial),
                        Value::number(static_cast<mc_number_t>(packet.serial)));
    env.heap->structSet(obj, static_cast<uint32_t>(RadioPacketField::Time),
                        Value::number(static_cast<mc_number_t>(packet.time)));
    return true;
}

} // namespace detail

/**
 * Host function `Radio.receive`: the stateless `receive(since)` filter. Returns a
 * managed `RadioPacket[]` of every ring packet whose sequence is greater than the
 * `since` argument (arg 1), in arrival order. Keeps no cursor of its own -- the
 * caller passes its last-seen sequence and records the new one from the batch.
 * Each element is a managed struct with the sequence, typed value, name, text,
 * raw payload buffer, and metadata (RSSI, sender serial, system time). An
 * unrecognized receiver yields an empty list; a heap allocation failure faults.
 * `hostData` is the bound {@link MicroBitV2RadioReceiveEnv}. Mirrors the
 * `Radio.receive` host function in
 * packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
inline Status execRadioReceive(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = kNilValue;
        return Status::ok();
    }
    MicroBitV2RadioReceiveEnv &env = *static_cast<MicroBitV2RadioReceiveEnv *>(hostData);
    const uint32_t listTypeIdx =
        env.types->findAtomType(static_cast<uint32_t>(MicroBitV2TypeAtomId::RadioPacketList));
    const uint32_t packetTypeIdx =
        env.types->findAtomType(static_cast<uint32_t>(MicroBitV2TypeAtomId::RadioPacket));

    Value listValue;
    if (!env.heap->newList(listTypeIdx, env.roots, listValue))
    {
        return Status::fail(ErrorCode::StackOverflow);
    }
    ManagedHeap::Pin listPin(*env.heap, listValue);

    const bool radioReady =
        !args.empty() && detail::isReceiver(args[0], MicroBitV2TypeAtomId::Radio);
    if (radioReady)
    {
        RadioPort *radio = env.radio;
        const int since = static_cast<int>(detail::numberArgOr(args, 1, 0));
        for (uint32_t i = 0; i < radio->ringSize(); i++)
        {
            const RadioPacketView &packet = radio->ringAt(i);
            if (packet.seq <= since)
            {
                continue;
            }
            Value packetValue;
            if (!detail::buildRadioPacketStruct(env, packetTypeIdx, packet, packetValue))
            {
                return Status::fail(ErrorCode::StackOverflow);
            }
            ManagedHeap::Pin packetPin(*env.heap, packetValue);
            if (!env.heap->listPush(env.heap->list(listValue), packetValue, env.roots))
            {
                return Status::fail(ErrorCode::StackOverflow);
            }
        }
    }

    result = listValue;
    return Status::ok();
}

/**
 * Host function `Radio.currentSeq`: the current head sequence (the most recent
 * packet's sequence, or 0 when the ring has received nothing), so a caller can
 * arm its `receive(since)` cursor to "from now." Stateless. `hostData` is the
 * bound {@link MicroBitV2RadioEnv}. Mirrors the `Radio.currentSeq` host function
 * in packages/wodal/src/targets/microbit-v2/wendoo/module.ts.
 */
inline Status execRadioCurrentSeq(void *hostData, Span<const Value> args, Value &result)
{
    if (hostData == nullptr)
    {
        result = Value::number(0);
        return Status::ok();
    }
    MicroBitV2RadioEnv &env = *static_cast<MicroBitV2RadioEnv *>(hostData);
    RadioPort *radio = detail::radioReceiver(env, args);
    result = Value::number(radio != nullptr ? static_cast<mc_number_t>(radio->headSequence()) : 0);
    return Status::ok();
}

} // namespace wendoo
