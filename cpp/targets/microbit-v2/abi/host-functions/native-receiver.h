#pragma once

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

} // namespace mindcraft
