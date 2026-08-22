#pragma once

#include <cstdint>

namespace wendoo {
namespace binary32 {

/**
 * Parse a leading decimal-number prefix of an ASCII byte range into an IEEE
 * binary32 value, reproducing JavaScript `Math.fround(Number.parseFloat(text))`
 * bit-for-bit.
 *
 * Inputs:
 * - `bytes`: pointer to the first byte to scan; may be null only when
 *   `length` is 0.
 * - `length`: number of bytes available at `bytes`.
 *
 * Behavior matches `Number.parseFloat` exactly: leading ASCII whitespace is
 * skipped, an optional sign is read, then either the literal "Infinity" or a
 * decimal mantissa (with optional fraction and optional well-formed exponent)
 * is consumed as the longest valid numeric prefix; any trailing bytes are
 * ignored. The decimal value is correctly rounded (round-to-nearest,
 * ties-to-even) first to binary64 and then to binary32, matching the double
 * rounding that `Math.fround(Number.parseFloat(...))` performs.
 *
 * Output: the parsed binary32 value, with sign applied. Overflow yields a
 * signed infinity; underflow yields a signed zero; subnormals are produced
 * faithfully. When no valid number can be parsed, returns a quiet NaN; mapping
 * that NaN to another value is the caller's responsibility.
 *
 * Uses integer arithmetic only; performs no floating-point arithmetic and no
 * libc string-to-number conversion.
 */
float parseNumber(const char* bytes, uint32_t length);

} // namespace binary32
} // namespace wendoo
