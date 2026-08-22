#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "codal/radio-wire.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/value.h"
#include "core/runtime/when-result.h"
#include "targets/microbit-v2/abi/host-binding-conversions.h"

namespace wendoo
{

/**
 * The radio port and managed heap the `radio send` tile reaches: the heap reads
 * a string value (an explicit argument or the WHEN-result). Every pointer is
 * non-owning and must outlive every dispatch.
 */
struct MicroBitV2RadioSendEnv
{
    RadioPort *radio = nullptr;
    ManagedHeap *heap = nullptr;
};

/**
 * Positional arg slots of the `radio send` tile, in the flattened call-def order
 * of the wodal action source (bag(optional(choice(AnonNumber, AnonString,
 * AnonBoolean, AnonBuffer)))). At most one is present; all absent falls back to
 * the WHEN-result.
 */
inline constexpr uint32_t kRadioSendNumberArgSlot = 0;
inline constexpr uint32_t kRadioSendStringArgSlot = 1;
inline constexpr uint32_t kRadioSendBooleanArgSlot = 2;
inline constexpr uint32_t kRadioSendBufferArgSlot = 3;

namespace detail
{

/**
 * Sends `value` as a radio packet when it is a Number / String / Boolean /
 * Buffer; otherwise a no-op.
 */
inline void radioSendValue(MicroBitV2RadioSendEnv &env, const Value &value)
{
    RadioSendView view{};
    view.group = env.radio->group();
    if (value.isNumber())
    {
        const mc_number_t v = value.asNumber();
        view.type = radioNumberIsInteger(v) ? static_cast<int>(RadioPacketType::Number)
                                            : static_cast<int>(RadioPacketType::Double);
        view.value = v;
        env.radio->send(view);
    }
    else if (value.isString())
    {
        const char *bytes = nullptr;
        uint32_t length = 0;
        if (env.heap->stringContent(value, bytes, length))
        {
            view.type = static_cast<int>(RadioPacketType::String);
            view.text = reinterpret_cast<const uint8_t *>(bytes);
            view.textLen = length;
            env.radio->send(view);
        }
    }
    else if (value.isBoolean())
    {
        view.type = static_cast<int>(RadioPacketType::Number);
        view.value = value.asBoolean() ? 1 : 0;
        env.radio->send(view);
    }
    else if (value.isBuffer())
    {
        const uint8_t *bytes = nullptr;
        uint32_t length = 0;
        if (env.heap->bufferContent(value, bytes, length))
        {
            view.type = static_cast<int>(RadioPacketType::Buffer);
            view.bytes = bytes;
            view.bytesLen = length;
            env.radio->send(view);
        }
    }
}

} // namespace detail

/**
 * `radio send` tile body: broadcasts the explicit anonymous value (Number /
 * String / Boolean / Buffer) if present, otherwise the rule's WHEN-result. A
 * Boolean sends as a NUMBER 0/1; a Buffer sends as a BUFFER packet; a
 * non-sendable value is a silent no-op. The group is the device's current
 * radio group. Mirrors the wodal radio-send oracle.
 */
inline Value execRadioSend(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    if (hostData == nullptr)
    {
        return kVoidValue;
    }
    MicroBitV2RadioSendEnv &env = *static_cast<MicroBitV2RadioSendEnv *>(hostData);
    if (env.radio == nullptr)
    {
        return kVoidValue;
    }
    if (detail::hasArg(args, kRadioSendNumberArgSlot))
    {
        detail::radioSendValue(env, args[kRadioSendNumberArgSlot]);
    }
    else if (detail::hasArg(args, kRadioSendStringArgSlot))
    {
        detail::radioSendValue(env, args[kRadioSendStringArgSlot]);
    }
    else if (detail::hasArg(args, kRadioSendBooleanArgSlot))
    {
        detail::radioSendValue(env, args[kRadioSendBooleanArgSlot]);
    }
    else if (detail::hasArg(args, kRadioSendBufferArgSlot))
    {
        detail::radioSendValue(env, args[kRadioSendBufferArgSlot]);
    }
    else
    {
        detail::radioSendValue(env, getWhenResult(ctx, *env.heap));
    }
    return kVoidValue;
}

} // namespace wendoo
