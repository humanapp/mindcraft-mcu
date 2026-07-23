#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/value.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

namespace mindcraft
{

namespace detail
{

/** True when `value` is a native struct of `typeAtomId`. */
inline bool isReceiver(const Value &value, MicroBitV2TypeAtomId typeAtomId)
{
    return value.isStruct() && value.typeId() == static_cast<uint32_t>(typeAtomId);
}

} // namespace detail

/**
 * The value of field `fieldId` of the options struct argument at `slot`, or nil
 * when the arg is absent or is not a struct value. `heap` resolves the arg's
 * managed struct object; the fields are the caller-constructed option struct the
 * device-API method carries (e.g. PlaySoundOptions).
 */
inline Value optionStructField(const ManagedHeap &heap, Span<const Value> args, uint32_t slot,
                               uint32_t fieldId)
{
    if (slot >= args.size() || !args[slot].isStruct())
    {
        return kNilValue;
    }
    StructObject *obj = heap.structOf(args[slot]);
    return obj != nullptr ? heap.structGet(obj, fieldId) : kNilValue;
}

/** True when the boolean field `fieldId` of the options struct arg at `slot` is present and true.
 */
inline bool optionStructFlag(const ManagedHeap &heap, Span<const Value> args, uint32_t slot,
                             uint32_t fieldId)
{
    const Value field = optionStructField(heap, args, slot, fieldId);
    return field.isBoolean() && field.asBoolean();
}

} // namespace mindcraft
