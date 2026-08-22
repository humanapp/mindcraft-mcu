#include "core/runtime/binary32-transcendental.h"

#include <cstdint>

// Algorithms and coefficients ported from the Cephes single-precision math
// library by Stephen L. Moshier (Release 2.2, 1992), in explicit binary32
// arithmetic: every operation is a native `float` op that rounds to binary32.

namespace wendoo {
namespace binary32 {
namespace {

constexpr float kPi = 3.141592653589793238f;
constexpr float kHalfPi = 1.5707963267948966192f;
constexpr float kQuarterPi = 0.7853981633974483096f;
constexpr float kFourOverPi = 1.27323954473516f;
// Cody-Waite three-part pi/4, for sine/cosine/tangent argument reduction.
constexpr float kDP1 = 0.78515625f;
constexpr float kDP2 = 2.4187564849853515625e-4f;
constexpr float kDP3 = 3.77489497744594108e-8f;
constexpr float kSinLossThreshold = 8192.0f;
constexpr float kIntegerLimit = 16777215.0f; // 2^24 - 1
constexpr float kLog2e = 1.44269504088896341f;
constexpr float kSqrtHalf = 0.707106781186547524f;
// Cody-Waite two-part ln(2): kLn2Hi + kLn2Lo.
constexpr float kLn2Hi = 0.693359375f;
constexpr float kLn2Lo = -2.12194440e-4f;
constexpr float kMaxLog = 88.72283905206835f;
constexpr float kMinLog = -103.278929903431851103f;

float infinity() { return __builtin_inff(); }
float quietNaN() { return __builtin_nanf(""); }
bool isNan(float x) { return __builtin_isnan(x); }

/** Horner evaluation of a polynomial in `v`, two roundings per term. */
float horner(const float* coeffs, int count, float v) {
  float y = coeffs[0];
  for (int i = 1; i < count; i++) {
    y = y * v + coeffs[i];
  }
  return y;
}

/** Sine on a reduced argument: x + x^3 * P(x^2) with z = x*x. */
float sinReduced(float z, float x) {
  static const float p[] = {-1.9515295891e-4f, 8.3321608736e-3f, -1.6666654611e-1f};
  float y = horner(p, 3, z);
  y = y * z;
  y = y * x;
  y = y + x;
  return y;
}

/** Cosine on a reduced argument: 1 - 0.5*z + z^2 * Q(z) with z = x*x. */
float cosReduced(float z) {
  static const float q[] = {2.443315711809948e-5f, -1.388731625493765e-3f, 4.166664568298827e-2f};
  float y = horner(q, 3, z);
  y = y * z;
  y = y * z;
  y = y - 0.5f * z;
  y = y + 1.0f;
  return y;
}

/** Splits `x` (must be finite and > 0) into a mantissa in [0.5, 1) and a
 * power-of-two exponent. Scaling by halves and doublings is exact. */
float frexpValue(float x, int& e) {
  float m = x;
  int exponent = 0;
  while (m >= 1.0f) {
    m = m * 0.5f;
    exponent++;
  }
  while (m < 0.5f) {
    m = m * 2.0f;
    exponent--;
  }
  e = exponent;
  return m;
}

/** Returns z * 2^n with a single final rounding; the power-of-two scale is
 * built exactly by repeated halving or doubling. */
float ldexpValue(float z, int n) {
  float scale = 1.0f;
  if (n >= 0) {
    for (int i = 0; i < n; i++) {
      scale = scale * 2.0f;
    }
  } else {
    for (int i = 0; i < -n; i++) {
      scale = scale * 0.5f;
    }
  }
  return z * scale;
}

/** |base|^e by exact binary exponentiation. */
float integerPow(float base, uint32_t e) {
  float result = 1.0f;
  while (e != 0) {
    if ((e & 1u) != 0u) {
      result = result * base;
    }
    base = base * base;
    e >>= 1;
  }
  return result;
}

/** True when `y` is an odd integer (no odd integers are representable past
 * 2^24, so large magnitudes are never odd). */
bool isOddInteger(float y) {
  if (y != __builtin_truncf(y)) {
    return false;
  }
  return __builtin_fmodf(__builtin_fabsf(y), 2.0f) == 1.0f;
}

} // namespace

float sin(float x) {
  if (!__builtin_isfinite(x)) {
    return quietNaN();
  }
  int sign = 1;
  if (x < 0.0f) {
    sign = -1;
    x = -x;
  }
  if (x > kIntegerLimit) {
    return 0.0f;
  }
  uint32_t j = static_cast<uint32_t>(kFourOverPi * x);
  float y = static_cast<float>(j);
  if ((j & 1u) != 0u) {
    j += 1u;
    y = y + 1.0f;
  }
  j &= 7u;
  if (j > 3u) {
    sign = -sign;
    j -= 4u;
  }
  if (x > kSinLossThreshold) {
    x = x - y * kQuarterPi;
  } else {
    x = ((x - y * kDP1) - y * kDP2) - y * kDP3;
  }
  const float z = x * x;
  if (j == 1u || j == 2u) {
    y = cosReduced(z);
  } else {
    y = sinReduced(z, x);
  }
  return sign < 0 ? -y : y;
}

float cos(float x) {
  if (!__builtin_isfinite(x)) {
    return quietNaN();
  }
  int sign = 1;
  if (x < 0.0f) {
    x = -x;
  }
  if (x > kIntegerLimit) {
    return 0.0f;
  }
  uint32_t j = static_cast<uint32_t>(kFourOverPi * x);
  float y = static_cast<float>(j);
  if ((j & 1u) != 0u) {
    j += 1u;
    y = y + 1.0f;
  }
  j &= 7u;
  if (j > 3u) {
    j -= 4u;
    sign = -sign;
  }
  if (j > 1u) {
    sign = -sign;
  }
  if (x > kSinLossThreshold) {
    x = x - y * kQuarterPi;
  } else {
    x = ((x - y * kDP1) - y * kDP2) - y * kDP3;
  }
  const float z = x * x;
  if (j == 1u || j == 2u) {
    y = sinReduced(z, x);
  } else {
    y = cosReduced(z);
  }
  return sign < 0 ? -y : y;
}

float tan(float x) {
  if (!__builtin_isfinite(x)) {
    return quietNaN();
  }
  int sign = 1;
  if (x < 0.0f) {
    x = -x;
    sign = -1;
  }
  if (x > kSinLossThreshold) {
    return 0.0f;
  }
  uint32_t j = static_cast<uint32_t>(kFourOverPi * x);
  float y = static_cast<float>(j);
  if ((j & 1u) != 0u) {
    j += 1u;
    y = y + 1.0f;
  }
  const float z = ((x - y * kDP1) - y * kDP2) - y * kDP3;
  const float zz = z * z;
  if (x > 1.0e-4f) {
    static const float p[] = {9.38540185543e-3f, 3.11992232697e-3f, 2.44301354525e-2f,
                              5.34112807005e-2f, 1.33387994085e-1f, 3.33331568548e-1f};
    y = horner(p, 6, zz);
    y = y * zz;
    y = y * z;
    y = y + z;
  } else {
    y = z;
  }
  if ((j & 2u) != 0u) {
    y = -1.0f / y;
  }
  return sign < 0 ? -y : y;
}

float asin(float x) {
  if (isNan(x)) {
    return quietNaN();
  }
  if (x == 0.0f) {
    return x;
  }
  int sign = 1;
  float a = x;
  if (x < 0.0f) {
    sign = -1;
    a = -x;
  }
  if (a > 1.0f) {
    return quietNaN();
  }
  if (a < 1.0e-4f) {
    return sign < 0 ? -a : a;
  }
  float reduced;
  bool reflected;
  float z;
  if (a > 0.5f) {
    z = 0.5f * (1.0f - a);
    reduced = __builtin_sqrtf(z);
    reflected = true;
  } else {
    reduced = a;
    z = reduced * reduced;
    reflected = false;
  }
  static const float p[] = {4.2163199048e-2f, 2.4181311049e-2f, 4.5470025998e-2f, 7.4953002686e-2f,
                            1.6666752422e-1f};
  float y = horner(p, 5, z);
  y = y * z;
  y = y * reduced;
  y = y + reduced;
  if (reflected) {
    y = y + y;
    y = kHalfPi - y;
  }
  return sign < 0 ? -y : y;
}

float acos(float x) {
  if (isNan(x)) {
    return quietNaN();
  }
  if (x < -1.0f || x > 1.0f) {
    return quietNaN();
  }
  if (x < -0.5f) {
    return kPi - 2.0f * asin(__builtin_sqrtf(0.5f * (1.0f + x)));
  }
  if (x > 0.5f) {
    return 2.0f * asin(__builtin_sqrtf(0.5f * (1.0f - x)));
  }
  return kHalfPi - asin(x);
}

float atan(float x) {
  if (isNan(x)) {
    return quietNaN();
  }
  int sign = 1;
  float a = x;
  if (x < 0.0f) {
    sign = -1;
    a = -x;
  }
  float y;
  if (a > 2.414213562373095f) {
    y = kHalfPi;
    a = -(1.0f / a);
  } else if (a > 0.4142135623730950f) {
    y = kQuarterPi;
    a = (a - 1.0f) / (a + 1.0f);
  } else {
    y = 0.0f;
  }
  const float z = a * a;
  static const float p[] = {8.05374449538e-2f, -1.38776856032e-1f, 1.99777106478e-1f,
                            -3.33329491539e-1f};
  float poly = horner(p, 4, z);
  poly = poly * z;
  poly = poly * a;
  poly = poly + a;
  y = y + poly;
  return sign < 0 ? -y : y;
}

float atan2(float y, float x) {
  if (isNan(x) || isNan(y)) {
    return quietNaN();
  }
  int code = 0;
  if (x < 0.0f) {
    code = 2;
  }
  if (y < 0.0f) {
    code |= 1;
  }
  if (x == 0.0f) {
    if ((code & 1) != 0) {
      return -kHalfPi;
    }
    if (y == 0.0f) {
      return 0.0f;
    }
    return kHalfPi;
  }
  if (y == 0.0f) {
    if ((code & 2) != 0) {
      return kPi;
    }
    return 0.0f;
  }
  float w;
  switch (code) {
  case 2:
    w = kPi;
    break;
  case 3:
    w = -kPi;
    break;
  default:
    w = 0.0f;
    break;
  }
  const float z = atan(y / x);
  return w + z;
}

float exp(float x) {
  if (isNan(x)) {
    return quietNaN();
  }
  if (x > kMaxLog) {
    return infinity();
  }
  if (x < kMinLog) {
    return 0.0f;
  }
  const float k = __builtin_floorf(kLog2e * x + 0.5f);
  x = x - k * kLn2Hi;
  x = x - k * kLn2Lo;
  const int n = static_cast<int>(k);
  const float zz = x * x;
  static const float p[] = {1.9875691500e-4f, 1.3981999507e-3f, 8.3334519073e-3f,
                            4.1665795894e-2f, 1.6666665459e-1f, 5.0000001201e-1f};
  float y = horner(p, 6, x);
  y = y * zz;
  y = y + x;
  y = y + 1.0f;
  return ldexpValue(y, n);
}

float log(float x) {
  if (isNan(x)) {
    return quietNaN();
  }
  if (x < 0.0f) {
    return quietNaN();
  }
  if (x == 0.0f) {
    return -infinity();
  }
  if (__builtin_isinf(x)) {
    return infinity();
  }
  int e;
  float m = frexpValue(x, e);
  if (m < kSqrtHalf) {
    e -= 1;
    m = m + m - 1.0f;
  } else {
    m = m - 1.0f;
  }
  const float z = m * m;
  static const float p[] = {7.0376836292e-2f,  -1.1514610310e-1f, 1.1676998740e-1f,
                            -1.2420140846e-1f, 1.4249322787e-1f,  -1.6668057665e-1f,
                            2.0000714765e-1f,  -2.4999993993e-1f, 3.3333331174e-1f};
  float y = horner(p, 9, m);
  y = y * m;
  y = y * z;
  if (e != 0) {
    const float fe = static_cast<float>(e);
    y = y + kLn2Lo * fe;
  }
  y = y + (-0.5f) * z;
  float r = m + y;
  if (e != 0) {
    const float fe = static_cast<float>(e);
    r = r + kLn2Hi * fe;
  }
  return r;
}

float pow(float base, float exponent) {
  if (exponent == 0.0f) {
    return 1.0f;
  }
  if (isNan(exponent) || isNan(base)) {
    return quietNaN();
  }
  const float absBase = __builtin_fabsf(base);
  if (__builtin_isinf(exponent)) {
    if (absBase == 1.0f) {
      return quietNaN();
    }
    if (exponent > 0.0f) {
      return absBase > 1.0f ? infinity() : 0.0f;
    }
    return absBase > 1.0f ? 0.0f : infinity();
  }
  if (__builtin_isinf(base)) {
    if (base > 0.0f) {
      return exponent > 0.0f ? infinity() : 0.0f;
    }
    const bool odd = isOddInteger(exponent);
    if (exponent > 0.0f) {
      return odd ? -infinity() : infinity();
    }
    return odd ? -0.0f : 0.0f;
  }
  if (base == 0.0f) {
    const bool negZero = __builtin_signbit(base);
    if (exponent > 0.0f) {
      return (negZero && isOddInteger(exponent)) ? -0.0f : 0.0f;
    }
    return (negZero && isOddInteger(exponent)) ? -infinity() : infinity();
  }
  const bool integerExponent = exponent == __builtin_truncf(exponent);
  if (base < 0.0f && !integerExponent) {
    return quietNaN();
  }
  if (integerExponent && __builtin_fabsf(exponent) <= 2147483648.0f) {
    const uint32_t e = static_cast<uint32_t>(__builtin_fabsf(exponent));
    const float magnitude = integerPow(absBase, e);
    const float result = exponent < 0.0f ? 1.0f / magnitude : magnitude;
    const bool negate = base < 0.0f && (e & 1u) != 0u;
    return negate ? -result : result;
  }
  return exp(exponent * log(absBase));
}

bool multiplyAddRoundsTwice() {
  // 1 + 2^-12; squared, the exact product needs a bit past binary32 precision,
  // so a fused multiply-add keeps it while a separate rounded multiply drops it.
  volatile float a = 1.000244140625f;
  volatile float b = 1.000244140625f;
  volatile float c = -1.0f;
  const float fa = a;
  const float fb = b;
  const float fc = c;
  const float fused = fa * fb + fc;
  volatile float product = fa * fb;
  const float twoStep = product + fc;
  return fused == twoStep;
}

} // namespace binary32
} // namespace wendoo
