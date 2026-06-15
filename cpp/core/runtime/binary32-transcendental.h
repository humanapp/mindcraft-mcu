#pragma once

namespace mindcraft {
namespace binary32 {

/**
 * Single-precision (IEEE binary32) transcendental functions for the device
 * numeric profile. Each computes entirely in `float` with no internal double,
 * rounding to binary32 at every step. Results are a few ULP accurate, not
 * correctly rounded.
 *
 * Algorithms and coefficients are ported from the Cephes single-precision math
 * library by Stephen L. Moshier (Release 2.2, 1992).
 */

/** Sine of `x` radians. Non-finite input yields NaN; |x| past the f32 integer
 * range (2^24 - 1) yields 0. */
float sin(float x);

/** Cosine of `x` radians. Non-finite input yields NaN; |x| past the f32 integer
 * range yields 0. */
float cos(float x);

/** Tangent of `x` radians. Non-finite input yields NaN; |x| past 8192 yields 0. */
float tan(float x);

/** Arcsine of `x`, in radians. |x| > 1 yields NaN. */
float asin(float x);

/** Arccosine of `x`, in radians. |x| > 1 yields NaN. */
float acos(float x);

/** Arctangent of `x`, in radians. */
float atan(float x);

/** Two-argument arctangent of `y / x`, in radians, resolving the quadrant from
 * the signs of both arguments. */
float atan2(float y, float x);

/** Natural exponential of `x`. Overflow yields +Infinity, underflow yields 0. */
float exp(float x);

/** Natural logarithm of `x`. Zero yields -Infinity, negative input yields NaN. */
float log(float x);

/** `base` raised to `exponent`, following the ECMAScript exponentiation special
 * cases. Integer exponents use exact binary exponentiation. */
float pow(float base, float exponent);

/** True when `a * b + c` evaluates as a rounded multiply followed by a rounded
 * add (two roundings) in this translation unit; false when it is fused into a
 * single rounded multiply-add. The single-precision functions here depend on
 * per-operation rounding; a false result indicates the unit was built without
 * -ffp-contract=off. */
bool multiplyAddRoundsTwice();

} // namespace binary32
} // namespace mindcraft
