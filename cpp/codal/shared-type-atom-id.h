#pragma once

#include <array>
#include <cstdint>

#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/type-registry.h"

namespace mindcraft {

/**
 * Stable type-atom ids of the shared nominal types: structs common to every
 * target. Mirrors the WodalSharedTypeAtomId enum in
 * packages/wodal/src/mindcraft/shared-type-ids.ts. Serialized programs
 * reference nominal types by these values, so the values are wire-stable:
 * never renumber or reuse a value; append new members at the next free id.
 * All values are at or above {@link SHARED_TYPE_ATOM_BASE}.
 */
enum class SharedTypeAtomId : uint32_t {
  Image = 2048,
};

/**
 * Number of declared {@link SharedTypeAtomId} members; ids are dense from
 * {@link SHARED_TYPE_ATOM_BASE}.
 */
inline constexpr uint32_t kSharedTypeAtomIdCount = 1;

/**
 * Field storage slot count of the `Image` value struct: its `width`, `height`,
 * and `pixels` fields (ids 0, 1, 2), so highest field id + 1. Mirrors ImageField
 * in packages/wodal/src/mindcraft/shared-type-ids.ts.
 */
inline constexpr uint32_t kSharedImageSlotCount = 3;

/** Number of shared registered (atom) value-struct slot-count entries. */
inline constexpr uint32_t kSharedRegisteredStructCount = 1;

/**
 * Builds the shared registered (atom) value-struct slot-count table: the
 * `Image` struct, constructed at runtime via `STRUCT_NEW`, whose atom TYPS entry
 * carries no field shape. Installed on a {@link TypeRegistry} so `STRUCT_NEW` can
 * size the allocation. The returned array must outlive any registry it is
 * installed into.
 */
inline std::array<RegisteredStructSlotCount, kSharedRegisteredStructCount>
makeSharedRegisteredStructSlotCounts() {
  return {{
      {static_cast<uint32_t>(SharedTypeAtomId::Image), kSharedImageSlotCount},
  }};
}

} // namespace mindcraft
