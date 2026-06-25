#pragma once

#include <cstdint>

#include "core/runtime/mc-number.h"

namespace mindcraft {

/**
 * Truncates a brain number toward zero to a non-negative integer: non-finite
 * values and values at or below zero become 0; a positive value truncates.
 * Mirrors `toNonNegativeInteger` in packages/wodal/src/core/numeric.ts.
 */
inline uint32_t toNonNegativeInteger(mc_number_t value) {
  if (value != value || value - value != 0.0f || value <= 0.0f) { // NaN, infinity, or <= 0
    return 0;
  }
  return static_cast<uint32_t>(value);
}

} // namespace mindcraft
