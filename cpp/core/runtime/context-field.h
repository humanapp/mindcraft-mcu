#pragma once

#include <cstdint>

namespace wendoo {

/**
 * Numeric field ids of the core `Context` struct. Each value is the field's
 * durable id and its storage slot. Mirrors the ContextField enum in
 * external/wendoo-lang/packages/core/src/runtime/context-types.ts.
 * Serialized programs carry these ids in `STRUCT_GET_FIELD` /
 * `STRUCT_SET_FIELD` operands, so the values are wire-stable: never renumber
 * or reuse a value; append new members at the next free id. Core owns
 * `Context` field ids 0-5; device-profile extensions start at 6.
 */
enum class ContextField : uint8_t {
  Time = 0,
  Dt = 1,
  Tick = 2,
  Brain = 3,
  Engine = 4,
  Rule = 5,
};

/** Number of declared {@link ContextField} members; ids are dense from 0. */
inline constexpr uint32_t kContextFieldCount = 6;

} // namespace wendoo
