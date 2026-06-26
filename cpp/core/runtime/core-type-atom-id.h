#pragma once

#include <cstdint>

namespace mindcraft {

/**
 * First type-atom id owned by a target; core type atoms are below this. Each
 * target's atoms are dense from here and are disambiguated across targets by
 * the program's device profile id. Mirrors TARGET_TYPE_ATOM_BASE in
 * external/mindcraft-lang/packages/core/src/runtime/abi-ids.ts.
 */
inline constexpr uint32_t TARGET_TYPE_ATOM_BASE = 1024;

/**
 * First type-atom id of the shared tier: nominal types common to every target
 * (e.g. `Image`), dense from here. Above every target's own atom range, so
 * shared atoms validate independently of any target. Mirrors
 * SHARED_TYPE_ATOM_BASE in
 * external/mindcraft-lang/packages/core/src/runtime/abi-ids.ts.
 */
inline constexpr uint32_t SHARED_TYPE_ATOM_BASE = 2048;

/**
 * Stable type-atom ids of the core nominal types: the scalar types, the named
 * core list type, and the built-in context structs. Mirrors the
 * CoreTypeAtomId enum in
 * external/mindcraft-lang/packages/core/src/runtime/abi-ids.ts. Serialized
 * programs reference nominal types by atom id, so the values are wire-stable:
 * never renumber or reuse a value; append new members at the next free id.
 *
 * For an enum type registered with an atom id, the declared symbol-list order
 * is ABI: enum values serialize as ordinals into that list, so the symbol
 * list is append-only.
 */
enum class CoreTypeAtomId : uint32_t {
  Void = 0,
  Nil = 1,
  Boolean = 2,
  Number = 3,
  String = 4,
  Any = 5,
  Function = 6,
  AnyList = 7,
  BrainContext = 8,
  EngineContext = 9,
  RuleContext = 10,
  Context = 11,
};

/** Number of declared {@link CoreTypeAtomId} members; ids are dense from 0. */
inline constexpr uint32_t kCoreTypeAtomIdCount = 12;

} // namespace mindcraft
