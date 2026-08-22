// Shortest round-trip binary32 formatting ported from Ryu by Ulf Adams
// (Apache-2.0 / Boost-1.0).

#include "core/runtime/binary32-format.h"

#include <cstdint>
#include <cstring>

namespace wendoo {
namespace binary32 {

namespace {

constexpr int32_t kFloatMantissaBits = 23;
constexpr int32_t kFloatBias = 127;
constexpr int32_t kFloatPow5InvBitcount = 59;
constexpr int32_t kFloatPow5Bitcount = 61;

/** Reconstructs a 64-bit power-of-five factor from its high/low 32-bit halves. */
constexpr uint64_t pack(uint32_t hi, uint32_t lo) {
  return (static_cast<uint64_t>(hi) << 32) | static_cast<uint64_t>(lo);
}

const uint64_t kFloatPow5InvSplit[55] = {
    pack(134217728, 1),          pack(107374182, 1717986919), pack(85899345, 3951369913),
    pack(68719476, 3161095930),  pack(109951162, 3339766570), pack(87960930, 953826338),
    pack(70368744, 763061070),   pack(112589990, 2938884630), pack(90071992, 2351107704),
    pack(72057594, 162899245),   pack(115292150, 1978625710), pack(92233720, 1582900568),
    pack(73786976, 1266320455),  pack(118059162, 308125809),  pack(94447329, 2823481025),
    pack(75557863, 3117778279),  pack(120892581, 4129451787), pack(96714065, 2444567971),
    pack(77371252, 1955654377),  pack(123794003, 3988040462), pack(99035203, 613451992),
    pack(79228162, 2208748512),  pack(126765060, 98023782),   pack(101412048, 78419026),
    pack(81129638, 1780722139),  pack(129807421, 1990161963), pack(103845937, 733136111),
    pack(83076749, 3163489267),  pack(132922799, 2484602449), pack(106338239, 2846675418),
    pack(85070591, 3136333794),  pack(68056473, 1650073576),  pack(108890357, 1781124262),
    pack(87112285, 4001879788),  pack(69689828, 3201503830),  pack(111503725, 4263412669),
    pack(89202980, 3410730135),  pack(71362384, 2728584108),  pack(114179815, 1788754195),
    pack(91343852, 1431003356),  pack(73075081, 3721783063),  pack(116920130, 4236865982),
    pack(93536104, 3389492785),  pack(74828883, 3570587688),  pack(119726214, 558979545),
    pack(95780971, 1306177095),  pack(76624777, 185948217),   pack(122599643, 1156510606),
    pack(98079714, 2643195403),  pack(78463771, 2973549782),  pack(125542034, 3039692732),
    pack(100433627, 3290747645), pack(80346902, 914611198),   pack(128555043, 2322371375),
    pack(102844034, 3575884019),
};

const uint64_t kFloatPow5Split[47] = {
    pack(268435456, 0),          pack(335544320, 0),          pack(419430400, 0),
    pack(524288000, 0),          pack(327680000, 0),          pack(409600000, 0),
    pack(512000000, 0),          pack(320000000, 0),          pack(400000000, 0),
    pack(500000000, 0),          pack(312500000, 0),          pack(390625000, 0),
    pack(488281250, 0),          pack(305175781, 1073741824), pack(381469726, 2415919104),
    pack(476837158, 872415232),  pack(298023223, 3766484992), pack(372529029, 3634364416),
    pack(465661287, 1321730048), pack(291038304, 2436694016), pack(363797880, 3045867520),
    pack(454747350, 3807334400), pack(284217094, 1305842176), pack(355271367, 3779786368),
    pack(444089209, 3650991136), pack(277555756, 671256724),  pack(346944695, 839070905),
    pack(433680868, 4270064103), pack(271050543, 521306416),  pack(338813178, 3872858492),
    pack(423516473, 2693589467), pack(529395592, 145761362),  pack(330872245, 91100851),
    pack(413590306, 1187617888), pack(516987882, 3632006008), pack(323117426, 3343745579),
    pack(403896783, 2032198326), pack(504870979, 1466506084), pack(315544362, 379695390),
    pack(394430452, 2622102886), pack(493038065, 3277628607), pack(308148791, 437905143),
    pack(385185988, 3768606901), pack(481482486, 415791331),  pack(300926553, 3481095053),
    pack(376158192, 1130143345), pack(470197740, 1412679181),
};

/** Bit count of 5^e, exact for the float-relevant range. */
uint32_t pow5bits(int32_t e) {
  return static_cast<uint32_t>(((static_cast<uint32_t>(e) * 1217359) >> 19) + 1);
}

/** floor(log10(2^e)), exact for the float-relevant range. */
uint32_t log10Pow2(int32_t e) { return (static_cast<uint32_t>(e) * 78913) >> 18; }

/** floor(log10(5^e)), exact for the float-relevant range. */
uint32_t log10Pow5(int32_t e) { return (static_cast<uint32_t>(e) * 732923) >> 20; }

/** Greatest p with 5^p dividing v. */
uint32_t pow5factor32(uint32_t v) {
  uint32_t count = 0;
  for (;;) {
    uint32_t q = v / 5;
    uint32_t r = v % 5;
    if (r != 0) {
      break;
    }
    v = q;
    count += 1;
  }
  return count;
}

/** True when 5^p divides v. */
bool multipleOfPowerOf5(uint32_t v, uint32_t p) { return pow5factor32(v) >= p; }

/** True when 2^p divides v, for p in 0..31. */
bool multipleOfPowerOf2(uint32_t v, uint32_t p) { return (v & ((1u << p) - 1)) == 0; }

/** Returns the high 32 bits of (m * factor) >> shift, for shift in 33..63. */
uint32_t mulShift32(uint32_t m, uint64_t factor, int32_t shift) {
  uint32_t factorLo = static_cast<uint32_t>(factor);
  uint32_t factorHi = static_cast<uint32_t>(factor >> 32);
  uint64_t bits0 = static_cast<uint64_t>(m) * factorLo;
  uint64_t bits1 = static_cast<uint64_t>(m) * factorHi;
  uint64_t sum = (bits0 >> 32) + bits1;
  uint64_t shifted = sum >> (shift - 32);
  return static_cast<uint32_t>(shifted);
}

uint32_t mulPow5InvDivPow2(uint32_t m, uint32_t q, int32_t j) {
  return mulShift32(m, kFloatPow5InvSplit[q], j);
}

uint32_t mulPow5divPow2(uint32_t m, uint32_t i, int32_t j) {
  return mulShift32(m, kFloatPow5Split[i], j);
}

/** Number of decimal digits in v, for v in 0..999999999. */
uint32_t decimalLength9(uint32_t v) {
  if (v >= 100000000) {
    return 9;
  }
  if (v >= 10000000) {
    return 8;
  }
  if (v >= 1000000) {
    return 7;
  }
  if (v >= 100000) {
    return 6;
  }
  if (v >= 10000) {
    return 5;
  }
  if (v >= 1000) {
    return 4;
  }
  if (v >= 100) {
    return 3;
  }
  if (v >= 10) {
    return 2;
  }
  return 1;
}

/** Shortest decimal mantissa and base-10 exponent of a finite nonzero f32. */
struct FloatingDecimal {
  uint32_t mantissa;
  int32_t exponent;
};

/**
 * Ryu f2d core for IEEE binary32. Inputs are the raw 23-bit mantissa field and
 * 8-bit exponent field of a finite nonzero value.
 */
FloatingDecimal f2d(uint32_t ieeeMantissa, uint32_t ieeeExponent) {
  int32_t e2;
  uint32_t m2;
  if (ieeeExponent == 0) {
    e2 = 1 - kFloatBias - kFloatMantissaBits - 2;
    m2 = ieeeMantissa;
  } else {
    e2 = static_cast<int32_t>(ieeeExponent) - kFloatBias - kFloatMantissaBits - 2;
    m2 = (1u << kFloatMantissaBits) | ieeeMantissa;
  }
  const bool even = (m2 & 1) == 0;
  const bool acceptBounds = even;
  const uint32_t mv = 4 * m2;
  const uint32_t mp = 4 * m2 + 2;
  const uint32_t mmShift = (ieeeMantissa != 0 || ieeeExponent <= 1) ? 1 : 0;
  const uint32_t mm = 4 * m2 - 1 - mmShift;

  uint32_t vr = 0;
  uint32_t vp = 0;
  uint32_t vm = 0;
  int32_t e10 = 0;
  bool vmIsTrailingZeros = false;
  bool vrIsTrailingZeros = false;
  uint8_t lastRemovedDigit = 0;

  if (e2 >= 0) {
    const uint32_t q = log10Pow2(e2);
    e10 = static_cast<int32_t>(q);
    const int32_t k = kFloatPow5InvBitcount + static_cast<int32_t>(pow5bits(q)) - 1;
    const int32_t i = -e2 + static_cast<int32_t>(q) + k;
    vr = mulPow5InvDivPow2(mv, q, i);
    vp = mulPow5InvDivPow2(mp, q, i);
    vm = mulPow5InvDivPow2(mm, q, i);
    if (q != 0 && (vp - 1) / 10 <= vm / 10) {
      const int32_t l = kFloatPow5InvBitcount + static_cast<int32_t>(pow5bits(q - 1)) - 1;
      lastRemovedDigit = static_cast<uint8_t>(
          mulPow5InvDivPow2(mv, q - 1, -e2 + static_cast<int32_t>(q) - 1 + l) % 10);
    }
    if (q <= 9) {
      if (mv % 5 == 0) {
        vrIsTrailingZeros = multipleOfPowerOf5(mv, q);
      } else if (acceptBounds) {
        vmIsTrailingZeros = multipleOfPowerOf5(mm, q);
      } else {
        vp -= multipleOfPowerOf5(mp, q) ? 1 : 0;
      }
    }
  } else {
    const uint32_t q = log10Pow5(-e2);
    e10 = static_cast<int32_t>(q) + e2;
    const int32_t i = -e2 - static_cast<int32_t>(q);
    const int32_t k = static_cast<int32_t>(pow5bits(i)) - kFloatPow5Bitcount;
    int32_t j = static_cast<int32_t>(q) - k;
    vr = mulPow5divPow2(mv, static_cast<uint32_t>(i), j);
    vp = mulPow5divPow2(mp, static_cast<uint32_t>(i), j);
    vm = mulPow5divPow2(mm, static_cast<uint32_t>(i), j);
    if (q != 0 && (vp - 1) / 10 <= vm / 10) {
      j = static_cast<int32_t>(q) - 1 -
          (static_cast<int32_t>(pow5bits(i + 1)) - kFloatPow5Bitcount);
      lastRemovedDigit =
          static_cast<uint8_t>(mulPow5divPow2(mv, static_cast<uint32_t>(i + 1), j) % 10);
    }
    if (q <= 1) {
      vrIsTrailingZeros = true;
      if (acceptBounds) {
        vmIsTrailingZeros = mmShift == 1;
      } else {
        --vp;
      }
    } else if (q < 31) {
      vrIsTrailingZeros = multipleOfPowerOf2(mv, q - 1);
    }
  }

  int32_t removed = 0;
  uint32_t output;
  if (vmIsTrailingZeros || vrIsTrailingZeros) {
    while (vp / 10 > vm / 10) {
      vmIsTrailingZeros &= (vm % 10 == 0);
      vrIsTrailingZeros &= (lastRemovedDigit == 0);
      lastRemovedDigit = static_cast<uint8_t>(vr % 10);
      vr /= 10;
      vp /= 10;
      vm /= 10;
      ++removed;
    }
    if (vmIsTrailingZeros) {
      while (vm % 10 == 0) {
        vrIsTrailingZeros &= (lastRemovedDigit == 0);
        lastRemovedDigit = static_cast<uint8_t>(vr % 10);
        vr /= 10;
        vp /= 10;
        vm /= 10;
        ++removed;
      }
    }
    if (vrIsTrailingZeros && lastRemovedDigit == 5 && vr % 2 == 0) {
      lastRemovedDigit = 4;
    }
    output =
        vr +
        (((vr == vm && (!acceptBounds || !vmIsTrailingZeros)) || lastRemovedDigit >= 5) ? 1 : 0);
  } else {
    while (vp / 10 > vm / 10) {
      lastRemovedDigit = static_cast<uint8_t>(vr % 10);
      vr /= 10;
      vp /= 10;
      vm /= 10;
      ++removed;
    }
    output = vr + ((vr == vm || lastRemovedDigit >= 5) ? 1 : 0);
  }

  FloatingDecimal result;
  result.mantissa = output;
  result.exponent = e10 + removed;
  return result;
}

/** IEEE binary32 sign, 8-bit exponent field, and 23-bit mantissa field. */
struct Binary32Fields {
  bool sign;
  uint32_t exponent;
  uint32_t mantissa;
};

/**
 * Decomposes an IEEE binary32 value into its raw sign bit, 8-bit exponent
 * field, and 23-bit mantissa field.
 */
Binary32Fields decodeBinary32(float value) {
  uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  Binary32Fields fields;
  fields.sign = (bits >> 31) != 0u;
  fields.exponent = (bits >> 23) & 0xffu;
  fields.mantissa = bits & 0x7fffffu;
  return fields;
}

/** Writes the decimal digits of value (with leading zeros) into buf[0..len). */
void digitsOf(uint32_t value, uint32_t len, char* buf) {
  for (int32_t i = static_cast<int32_t>(len) - 1; i >= 0; --i) {
    buf[i] = static_cast<char>('0' + (value % 10));
    value /= 10;
  }
}

} // namespace

uint32_t formatNumber(float value, char* out) {
  // NaN: not equal to itself.
  if (value != value) {
    std::memcpy(out, "NaN", 3);
    return 3;
  }
  // Infinity: magnitude exceeds the largest finite binary32 value.
  const float kMaxFinite = 3.4028234663852886e38f;
  if (value > kMaxFinite) {
    std::memcpy(out, "Infinity", 8);
    return 8;
  }
  if (value < -kMaxFinite) {
    std::memcpy(out, "-Infinity", 9);
    return 9;
  }
  if (value == 0.0f) {
    out[0] = '0';
    return 1;
  }

  Binary32Fields fields = decodeBinary32(value);
  FloatingDecimal dec = f2d(fields.mantissa, fields.exponent);
  const uint32_t k = decimalLength9(dec.mantissa);

  char digits[10];
  digitsOf(dec.mantissa, k, digits);

  const int32_t n = dec.exponent + static_cast<int32_t>(k);
  uint32_t pos = 0;
  if (fields.sign) {
    out[pos++] = '-';
  }

  const int32_t ki = static_cast<int32_t>(k);
  if (ki <= n && n <= 21) {
    std::memcpy(out + pos, digits, k);
    pos += k;
    for (int32_t i = 0; i < n - ki; ++i) {
      out[pos++] = '0';
    }
    return pos;
  }
  if (n > 0 && n <= 21) {
    std::memcpy(out + pos, digits, static_cast<uint32_t>(n));
    pos += static_cast<uint32_t>(n);
    out[pos++] = '.';
    std::memcpy(out + pos, digits + n, k - static_cast<uint32_t>(n));
    pos += k - static_cast<uint32_t>(n);
    return pos;
  }
  if (n > -6 && n <= 0) {
    out[pos++] = '0';
    out[pos++] = '.';
    for (int32_t i = 0; i < -n; ++i) {
      out[pos++] = '0';
    }
    std::memcpy(out + pos, digits, k);
    pos += k;
    return pos;
  }

  const int32_t exp = n - 1;
  out[pos++] = digits[0];
  if (k > 1) {
    out[pos++] = '.';
    std::memcpy(out + pos, digits + 1, k - 1);
    pos += k - 1;
  }
  out[pos++] = 'e';
  uint32_t absExp;
  if (exp >= 0) {
    out[pos++] = '+';
    absExp = static_cast<uint32_t>(exp);
  } else {
    out[pos++] = '-';
    absExp = static_cast<uint32_t>(-exp);
  }
  const uint32_t expLen = absExp >= 10 ? 2 : 1;
  digitsOf(absExp, expLen, out + pos);
  pos += expLen;
  return pos;
}

} // namespace binary32
} // namespace wendoo
