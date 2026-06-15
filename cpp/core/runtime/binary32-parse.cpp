#include "core/runtime/binary32-parse.h"

#include <cstring>

namespace mindcraft {
namespace binary32 {

namespace {

// IEEE binary64 layout constants used while building the intermediate double.
constexpr int kDoubleMantissaBits = 52;
constexpr int kDoubleExponentBias = 1023;
constexpr int kDoubleSignificandBits = 53;
constexpr int kDoubleMinNormalExp = -1022;
constexpr uint64_t kDoubleImplicitBit = uint64_t(1) << 52;
constexpr uint64_t kDoubleMantissaMask = kDoubleImplicitBit - 1;

// IEEE binary32 layout constants used while rounding the double to a float.
constexpr int kFloatMantissaBits = 23;
constexpr int kFloatExponentBias = 127;
constexpr int kFloatMaxBiasedExp = 0xFF;
constexpr int kFloatMinNormalExp = -126;

constexpr uint32_t kFloatQuietNaNBits = 0x7FC00000u;

// A nonnegative big integer stored as base-2^32 limbs, least significant first.
// Sized to hold the largest intermediate produced while converting any decimal
// string that this parser will ever accept (mantissa digits times a power of
// ten on one side, a power of ten on the other), with headroom for shifts.
struct BigInt {
  static constexpr int kMaxLimbs = 160;
  uint32_t limbs[kMaxLimbs];
  int count;

  void setZero() { count = 0; }

  bool isZero() const { return count == 0; }

  void setU32(uint32_t v) {
    if (v == 0) {
      count = 0;
    } else {
      limbs[0] = v;
      count = 1;
    }
  }

  void trim() {
    while (count > 0 && limbs[count - 1] == 0) {
      count--;
    }
  }

  // Multiply in place by a small value, adding `add` into the low limb.
  void mulAddSmall(uint32_t mul, uint32_t add) {
    uint64_t carry = add;
    for (int i = 0; i < count; i++) {
      uint64_t product = uint64_t(limbs[i]) * mul + carry;
      limbs[i] = uint32_t(product);
      carry = product >> 32;
    }
    while (carry != 0 && count < kMaxLimbs) {
      limbs[count++] = uint32_t(carry);
      carry >>= 32;
    }
  }

  // Shift left by `bits` (any nonnegative amount).
  void shiftLeft(int bits) {
    if (isZero() || bits == 0) {
      return;
    }
    int limbShift = bits >> 5;
    int bitShift = bits & 31;
    if (bitShift == 0) {
      for (int i = count - 1; i >= 0; i--) {
        limbs[i + limbShift] = limbs[i];
      }
    } else {
      int newCount = count + limbShift + 1;
      if (newCount > kMaxLimbs) {
        newCount = kMaxLimbs;
      }
      for (int i = count; i < newCount; i++) {
        limbs[i] = 0;
      }
      for (int i = count - 1; i >= 0; i--) {
        uint64_t v = uint64_t(limbs[i]) << bitShift;
        int hi = i + limbShift + 1;
        int lo = i + limbShift;
        if (hi < kMaxLimbs) {
          limbs[hi] |= uint32_t(v >> 32);
        }
        if (lo < kMaxLimbs) {
          limbs[lo] = uint32_t(v);
        }
      }
    }
    for (int i = 0; i < limbShift; i++) {
      limbs[i] = 0;
    }
    count += limbShift + (bitShift == 0 ? 0 : 1);
    if (count > kMaxLimbs) {
      count = kMaxLimbs;
    }
    trim();
  }

  // Number of significant bits (0 for a zero value).
  int bitLength() const {
    if (count == 0) {
      return 0;
    }
    uint32_t top = limbs[count - 1];
    int bits = (count - 1) * 32;
    while (top != 0) {
      bits++;
      top >>= 1;
    }
    return bits;
  }

  // Compare against another big integer: -1 if less, 0 if equal, 1 if greater.
  int compare(const BigInt& other) const {
    if (count != other.count) {
      return count < other.count ? -1 : 1;
    }
    for (int i = count - 1; i >= 0; i--) {
      if (limbs[i] != other.limbs[i]) {
        return limbs[i] < other.limbs[i] ? -1 : 1;
      }
    }
    return 0;
  }
};

// Multiply 10^exp into `value` for a nonnegative exp by chunking the power of
// ten into pieces that fit in a single 32-bit limb.
void mulPow10(BigInt& value, int exp) {
  static const uint32_t kPow10[] = {1u,      10u,      100u,      1000u,      10000u,
                                    100000u, 1000000u, 10000000u, 100000000u, 1000000000u};
  while (exp >= 9) {
    value.mulAddSmall(1000000000u, 0);
    exp -= 9;
  }
  if (exp > 0) {
    value.mulAddSmall(kPow10[exp], 0);
  }
}

// Divide `num` by `den` (den != 0), returning the quotient and leaving the
// remainder in `num`. Restoring long division at bit granularity; the operands
// here are at most a few hundred bits, so this stays cheap.
void divMod(const BigInt& num, const BigInt& den, BigInt& quotient, BigInt& remainder) {
  quotient.setZero();
  remainder.setZero();
  int numBits = num.bitLength();
  if (numBits == 0) {
    return;
  }
  for (int i = 0; i <= (numBits - 1) / 32; i++) {
    quotient.limbs[i] = 0;
  }
  quotient.count = (numBits - 1) / 32 + 1;
  for (int bit = numBits - 1; bit >= 0; bit--) {
    remainder.shiftLeft(1);
    uint32_t numBit = (num.limbs[bit >> 5] >> (bit & 31)) & 1u;
    if (numBit) {
      if (remainder.count == 0) {
        remainder.limbs[0] = 1;
        remainder.count = 1;
      } else {
        remainder.limbs[0] |= 1u;
      }
    }
    if (remainder.compare(den) >= 0) {
      // remainder -= den
      uint64_t borrow = 0;
      for (int i = 0; i < remainder.count; i++) {
        uint64_t d = (i < den.count) ? den.limbs[i] : 0;
        uint64_t cur = uint64_t(remainder.limbs[i]) - d - borrow;
        remainder.limbs[i] = uint32_t(cur);
        borrow = (cur >> 63) & 1u;
      }
      remainder.trim();
      quotient.limbs[bit >> 5] |= (1u << (bit & 31));
    }
  }
  quotient.trim();
}

// Assemble a binary64 from a sign, a normalized-or-subnormal 53-bit significand,
// and an unbiased exponent (the exponent of the most significant significand
// bit). The significand and exponent describe value = significand * 2^(exp-52)
// already rounded to 53 significant bits. Handles overflow and the subnormal
// range. Returns the binary64 bit pattern.
uint64_t assembleDouble(bool negative, uint64_t significand, int exponent) {
  uint64_t signBit = negative ? (uint64_t(1) << 63) : 0;
  if (significand == 0) {
    return signBit;
  }
  // Rounding may have carried the significand up to 2^53; renormalize.
  if (significand >> kDoubleSignificandBits) {
    significand >>= 1;
    exponent++;
  }
  int biased = exponent + kDoubleExponentBias;
  if (biased >= 0x7FF) {
    return signBit | (uint64_t(0x7FF) << kDoubleMantissaBits);
  }
  if (biased <= 0) {
    return signBit | (significand & kDoubleMantissaMask) |
           (uint64_t(biased > 0 ? biased : 0) << kDoubleMantissaBits);
  }
  return signBit | (uint64_t(biased) << kDoubleMantissaBits) | (significand & kDoubleMantissaMask);
}

// Convert the decimal value (digits * 10^decimalExp, all digits captured in
// `digits` as a big integer with `decimalExp` applied) to the binary64 bit
// pattern, correctly rounded to nearest, ties to even. `digits` is nonzero.
uint64_t decimalToDouble(bool negative, BigInt& digits, int decimalExp, bool droppedNonzero) {
  uint64_t signBit = negative ? (uint64_t(1) << 63) : 0;

  // Form numerator / denominator so the true value is num / den.
  BigInt num;
  BigInt den;
  num = digits;
  den.setU32(1);
  if (decimalExp >= 0) {
    mulPow10(num, decimalExp);
  } else {
    mulPow10(den, -decimalExp);
  }

  // Position of the value's most significant binary bit, estimated from bit
  // lengths and corrected to be exact below. value lies in
  // [2^msbExp, 2^(msbExp+1)).
  int msbExp = num.bitLength() - den.bitLength();

  // Number of significand bits the format can hold for this magnitude:
  // kDoubleSignificandBits when normal, fewer in the subnormal range.
  int allowedBits = kDoubleSignificandBits;
  if (msbExp < kDoubleMinNormalExp) {
    allowedBits += (msbExp - kDoubleMinNormalExp);
    if (allowedBits < 0) {
      allowedBits = 0;
    }
  }

  // Scale numerator/denominator by a power of two so the integer quotient holds
  // exactly the significand bits: quotientExp is the binary exponent of the
  // quotient's least significant bit, value == quotient * 2^quotientExp + frac.
  int quotientExp;
  if (msbExp < kDoubleMinNormalExp) {
    quotientExp = kDoubleMinNormalExp - (kDoubleSignificandBits - 1);
  } else {
    quotientExp = msbExp - (allowedBits - 1);
  }
  int shift = -quotientExp;
  if (shift >= 0) {
    num.shiftLeft(shift);
  } else {
    den.shiftLeft(-shift);
  }

  BigInt quotient;
  BigInt remainder;
  divMod(num, den, quotient, remainder);

  uint64_t q = 0;
  for (int i = quotient.count - 1; i >= 0; i--) {
    q = (q << 32) | quotient.limbs[i];
  }

  // The bit-length estimate can be one too low, giving a quotient with one extra
  // bit; fold that bit back into quotientExp by re-dividing one position higher.
  if (q >> allowedBits) {
    den.shiftLeft(1);
    quotientExp++;
    divMod(num, den, quotient, remainder);
    q = 0;
    for (int i = quotient.count - 1; i >= 0; i--) {
      q = (q << 32) | quotient.limbs[i];
    }
  }

  // Round to nearest, ties to even, using the exact remainder fraction
  // (remainder / den) below the least significant kept bit. When digits beyond
  // the captured window were dropped and at least one was nonzero, the true
  // fraction is strictly larger than remainder/den by less than one unit in the
  // last kept place, so a computed exact-half becomes a strictly-greater-half
  // (round up) and a computed below-half stays below half.
  bool roundUp = false;
  if (!remainder.isZero()) {
    BigInt twice = remainder;
    twice.shiftLeft(1);
    int cmp = twice.compare(den);
    if (cmp > 0) {
      roundUp = true;
    } else if (cmp == 0) {
      roundUp = droppedNonzero ? true : ((q & 1u) != 0);
    }
  } else if (droppedNonzero) {
    // The captured part divided exactly, but unseen nonzero digits push the true
    // value above the kept significand; less than half a unit, so never rounds.
  }
  if (roundUp) {
    q++;
  }

  if (q == 0) {
    return signBit;
  }

  // q is the significand and quotientExp the binary exponent of its low bit. The
  // unbiased exponent of the leading bit places the value for assembleDouble. A
  // rounding carry that grows q by a bit is absorbed by recomputing from q.
  int qbits = 0;
  for (uint64_t t = q; t != 0; t >>= 1) {
    qbits++;
  }
  int leadingExp = quotientExp + (qbits - 1);

  int shiftToTop = (kDoubleSignificandBits - 1) - (qbits - 1);
  uint64_t significand = (shiftToTop >= 0) ? (q << shiftToTop) : (q >> (-shiftToTop));

  return assembleDouble(negative, significand, leadingExp) | signBit;
}

// Round an IEEE binary64 bit pattern to the nearest IEEE binary32 bit pattern,
// round to nearest, ties to even. Reproduces JavaScript Math.fround.
uint32_t doubleBitsToFloatBits(uint64_t db) {
  uint32_t signBit = uint32_t(db >> 63) << 31;
  int exp64 = int((db >> kDoubleMantissaBits) & 0x7FF);
  uint64_t mant64 = db & kDoubleMantissaMask;

  if (exp64 == 0x7FF) {
    if (mant64 != 0) {
      return kFloatQuietNaNBits | signBit;
    }
    return signBit | (uint32_t(kFloatMaxBiasedExp) << kFloatMantissaBits);
  }

  // Build the full 53-bit significand and its unbiased exponent.
  uint64_t significand;
  int unbiasedExp;
  if (exp64 == 0) {
    if (mant64 == 0) {
      return signBit;
    }
    significand = mant64;
    unbiasedExp = kDoubleMinNormalExp;
    // Normalize: bring leading bit up to position 52.
    while ((significand & kDoubleImplicitBit) == 0) {
      significand <<= 1;
      unbiasedExp--;
    }
  } else {
    significand = mant64 | kDoubleImplicitBit;
    unbiasedExp = exp64 - kDoubleExponentBias;
  }

  // value = significand * 2^(unbiasedExp - 52), with significand in [2^52,2^53).
  // Target binary32: 24 significant bits. Determine the float exponent and the
  // number of low bits to drop (with round/sticky), handling subnormals.
  // Float normal range exponents: [-126, 127].
  if (unbiasedExp > kFloatExponentBias) {
    return signBit | (uint32_t(kFloatMaxBiasedExp) << kFloatMantissaBits);
  }

  int dropBits;
  int biased32;
  if (unbiasedExp < kFloatMinNormalExp) {
    // Subnormal float: significand scaled to exponent -126, drop more bits.
    dropBits =
        (kDoubleSignificandBits - 1) - kFloatMantissaBits + (kFloatMinNormalExp - unbiasedExp);
    biased32 = 0;
  } else {
    dropBits = (kDoubleSignificandBits - 1) - kFloatMantissaBits;
    biased32 = unbiasedExp + kFloatExponentBias;
  }

  if (dropBits >= 64) {
    // Far below the smallest subnormal: rounds to signed zero (the value is
    // less than half the smallest subnormal) or to the smallest subnormal.
    // With dropBits >= 64 the result mantissa is 0 and round bit is 0.
    return signBit;
  }

  uint64_t kept = significand >> dropBits;
  uint64_t roundBit = (significand >> (dropBits - 1)) & 1u;
  uint64_t stickyMask = (dropBits >= 1) ? ((uint64_t(1) << (dropBits - 1)) - 1) : 0;
  uint64_t sticky = (significand & stickyMask) != 0 ? 1 : 0;

  if (roundBit && (sticky || (kept & 1u))) {
    kept++;
  }

  // After rounding, kept holds the 24-bit (normal) or up-to-24-bit (subnormal)
  // significand including the implicit bit for normals.
  if (biased32 == 0) {
    // Subnormal: a carry into the implicit-bit position promotes to normal.
    if (kept & (uint64_t(1) << kFloatMantissaBits)) {
      // kept reached 2^23: this is the smallest normal.
      return signBit | (uint32_t(1) << kFloatMantissaBits) |
             uint32_t(kept & ((uint32_t(1) << kFloatMantissaBits) - 1));
    }
    return signBit | uint32_t(kept & ((uint32_t(1) << kFloatMantissaBits) - 1));
  }

  // Normal path: kept is in [2^23, 2^24] before/after rounding carry.
  if (kept & (uint64_t(1) << (kFloatMantissaBits + 1))) {
    // Rounding carried into bit 24: increment exponent, mantissa back to 0.
    kept >>= 1;
    biased32++;
  }
  if (biased32 >= kFloatMaxBiasedExp) {
    return signBit | (uint32_t(kFloatMaxBiasedExp) << kFloatMantissaBits);
  }
  return signBit | (uint32_t(biased32) << kFloatMantissaBits) |
         uint32_t(kept & ((uint32_t(1) << kFloatMantissaBits) - 1));
}

bool isAsciiWhitespace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

bool isDigit(char c) { return c >= '0' && c <= '9'; }

float bitsToFloat(uint32_t bits) {
  float f;
  std::memcpy(&f, &bits, sizeof(f));
  return f;
}

float floatFromDoubleBits(uint64_t db) { return bitsToFloat(doubleBitsToFloatBits(db)); }

} // namespace

float parseNumber(const char* bytes, uint32_t length) {
  uint32_t i = 0;

  while (i < length && isAsciiWhitespace(bytes[i])) {
    i++;
  }

  bool negative = false;
  if (i < length && (bytes[i] == '+' || bytes[i] == '-')) {
    negative = (bytes[i] == '-');
    i++;
  }

  // "Infinity" literal (case sensitive, exact).
  static const char kInfinity[] = "Infinity";
  if (i + 8 <= length && std::memcmp(bytes + i, kInfinity, 8) == 0) {
    uint32_t signBit = negative ? (uint32_t(1) << 31) : 0;
    return bitsToFloat(signBit | (uint32_t(kFloatMaxBiasedExp) << kFloatMantissaBits));
  }

  // Decimal mantissa: integer part, optional fraction part, optional exponent.
  BigInt digits;
  digits.setZero();
  int fractionDigits = 0;
  bool sawDigit = false;
  // The big integer captures the leading significant digits; positions beyond
  // the captured window are tracked only as a magnitude shift (for integer-part
  // digits) plus a sticky flag (any dropped nonzero digit), which together
  // suffice for correct rounding because dropped digits sit far below the
  // result's least significant bit.
  int extraIntegerDigits = 0;
  bool droppedNonzero = false;
  constexpr int kMaxSignificantDigits = 768;
  int capturedDigits = 0;

  // Integer part.
  while (i < length && isDigit(bytes[i])) {
    sawDigit = true;
    int d = bytes[i] - '0';
    if (capturedDigits < kMaxSignificantDigits) {
      digits.mulAddSmall(10, uint32_t(d));
      capturedDigits++;
    } else {
      extraIntegerDigits++;
      if (d != 0) {
        droppedNonzero = true;
      }
    }
    i++;
  }

  // Fraction part.
  if (i < length && bytes[i] == '.') {
    i++;
    while (i < length && isDigit(bytes[i])) {
      sawDigit = true;
      int d = bytes[i] - '0';
      if (capturedDigits < kMaxSignificantDigits) {
        digits.mulAddSmall(10, uint32_t(d));
        capturedDigits++;
        fractionDigits++;
      } else {
        if (d != 0) {
          droppedNonzero = true;
        }
      }
      i++;
    }
  }

  if (!sawDigit) {
    return bitsToFloat(kFloatQuietNaNBits);
  }

  // Optional exponent, consumed only if well-formed.
  int explicitExp = 0;
  if (i < length && (bytes[i] == 'e' || bytes[i] == 'E')) {
    uint32_t expCursor = i + 1;
    bool expNegative = false;
    if (expCursor < length && (bytes[expCursor] == '+' || bytes[expCursor] == '-')) {
      expNegative = (bytes[expCursor] == '-');
      expCursor++;
    }
    if (expCursor < length && isDigit(bytes[expCursor])) {
      long value = 0;
      while (expCursor < length && isDigit(bytes[expCursor])) {
        if (value < 1000000) {
          value = value * 10 + (bytes[expCursor] - '0');
        }
        expCursor++;
      }
      explicitExp = int(expNegative ? -value : value);
      i = expCursor;
    }
  }

  // Effective base-10 exponent: value == digits * 10^(decimalExp).
  int decimalExp = explicitExp - fractionDigits + extraIntegerDigits;

  uint32_t signBit = negative ? (uint32_t(1) << 31) : 0;

  if (digits.isZero()) {
    return bitsToFloat(signBit);
  }

  // The decimal order of magnitude is decimalExp plus the captured digit count.
  // binary64's finite range is about 10^-324 to 10^308; anything far outside
  // that overflows to a signed infinity (which frounds to a signed infinity) or
  // underflows to a signed zero. Resolving these directly keeps the big-integer
  // powers of ten bounded and matches the correctly-rounded result.
  long magnitude = long(decimalExp) + capturedDigits;
  if (magnitude > 400) {
    return bitsToFloat(signBit | (uint32_t(kFloatMaxBiasedExp) << kFloatMantissaBits));
  }
  if (magnitude < -400) {
    return bitsToFloat(signBit);
  }

  uint64_t doubleBits = decimalToDouble(negative, digits, decimalExp, droppedNonzero);
  return floatFromDoubleBits(doubleBits);
}

} // namespace binary32
} // namespace mindcraft
