#pragma once

#include <cstdint>

namespace wendoo {
namespace binary32 {

/**
 * Formats an IEEE binary32 value as its ECMAScript String(Number) decimal
 * grammar, using the shortest digit sequence that round-trips back to the same
 * binary32 value. ASCII bytes are written to out, which the caller must size to
 * at least 32 bytes; no NUL terminator is written. Returns the number of bytes
 * written.
 *
 * Special values produce "NaN", "Infinity", "-Infinity", and "0" (both +0 and
 * -0 produce "0"). All other finite values, including subnormals, produce a
 * minimal decimal representation.
 */
uint32_t formatNumber(float value, char* out);

} // namespace binary32
} // namespace wendoo
