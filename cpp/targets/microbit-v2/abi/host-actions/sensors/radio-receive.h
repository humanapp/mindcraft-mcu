#pragma once

#include <cstdint>

#include "codal/device-port.h"
#include "core/platform/span.h"
#include "core/runtime/execution-context.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/value.h"

namespace mindcraft
{

/**
 * The radio port plus the heap and roots a string receive sensor uses to
 * allocate its managed string result. The per-callsite cursor is a plain number
 * stored as call-site state, so the number sensor uses only the port and `heap`
 * / `roots` may be null when only the number sensor is bound. Every pointer is
 * non-owning and must outlive every dispatch.
 */
struct MicroBitV2RadioSensorEnv
{
    RadioPort *radio = nullptr;
    ManagedHeap *heap = nullptr;
    GcRoots *roots = nullptr;
};

namespace detail
{

/** True when `type` is a bare-number packet (NUMBER or DOUBLE). */
inline bool radioTypeIsNumber(int type)
{
    return type == 0 || type == 4;
}

/** True when `type` is a STRING packet. */
inline bool radioTypeIsString(int type)
{
    return type == 2;
}

} // namespace detail

/**
 * Typed radio receive sensor body: delivers the oldest still-unread packet of
 * its kind from the receive ring (NUMBER/DOUBLE for the number sensor, STRING
 * for the string sensor), advancing this call site's own cursor by one. The
 * delivered value -- including a 0 or an empty string -- is the result; genuine
 * absence (no matching packet this think, or the first evaluation after a page
 * enter) returns nil. The per-callsite cursor is a plain number; a page enter
 * arms it to the ring head. Mirrors the wodal radio-receive oracle.
 */
inline Value execRadioReceiveSensor(MicroBitV2RadioSensorEnv &env, bool wantString,
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
        const bool matches = wantString ? detail::radioTypeIsString(packet.type)
                                        : detail::radioTypeIsNumber(packet.type);
        if (!matches)
        {
            continue;
        }
        ctx.setCallSiteState(Value::number(static_cast<mc_number_t>(packet.seq)));
        if (wantString)
        {
            Value out;
            if (!env.heap->newString(reinterpret_cast<const char *>(packet.text), packet.textLen,
                                     env.roots, out))
            {
                return kNilValue;
            }
            return out;
        }
        return Value::number(packet.value);
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
    return execRadioReceiveSensor(*static_cast<MicroBitV2RadioSensorEnv *>(hostData), false, ctx,
                                  args);
}

/** String receive sensor body. Mirrors wodal `radioReceiveStringSensor`. */
inline Value execRadioReceiveString(void *hostData, ExecutionContext &ctx, Span<const Value> args)
{
    if (hostData == nullptr)
    {
        return kNilValue;
    }
    return execRadioReceiveSensor(*static_cast<MicroBitV2RadioSensorEnv *>(hostData), true, ctx,
                                  args);
}

/** Page-activation hook: drops the bound call site's cursor so it re-arms to the ring head. */
inline void radioReceivePageEntered(void *hostData, ExecutionContext &ctx)
{
    static_cast<void>(hostData);
    ctx.clearCallSiteState();
}

} // namespace mindcraft
