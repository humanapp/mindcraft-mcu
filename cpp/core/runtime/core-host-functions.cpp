#include "core/runtime/core-host-functions.h"

#include <cstring>

#include "core/runtime/binary32-format.h"
#include "core/runtime/binary32-parse.h"
#include "core/runtime/binary32-transcendental.h"
#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/type-registry.h"

namespace mindcraft {
namespace {

/**
 * Type-table index of `List<elementTypeIdx>` via the registry, or
 * {@link kNoTypeIdx} when the registry is absent, the element is unresolved, or
 * the program has no such list type.
 */
uint32_t listTypeId(const HostCallEnv& env, uint32_t elementTypeIdx) {
  if (env.types == nullptr || elementTypeIdx == kNoTypeIdx) {
    return kNoTypeIdx;
  }
  return env.types->findListType(elementTypeIdx);
}

/**
 * Type-table index of the core atom `atomId` via the registry, or
 * {@link kNoTypeIdx} when the registry is absent or the program lacks it.
 */
uint32_t atomTypeId(const HostCallEnv& env, CoreTypeAtomId atomId) {
  return env.types == nullptr ? kNoTypeIdx : env.types->findAtomType(static_cast<uint32_t>(atomId));
}

/**
 * The key element type of a map value, mirroring `MapKeys` in
 * external/mindcraft-lang/.../map-builtins.ts: the map's declared key type when
 * the value is typed, else the String atom.
 */
uint32_t mapKeyElementType(const HostCallEnv& env, const Value& mapValue) {
  if (env.types == nullptr) {
    return kNoTypeIdx;
  }
  const ProgramImage& program = env.types->program();
  const uint32_t mapTypeIdx = mapValue.typeId();
  if (mapTypeIdx < program.types.size() && program.types[mapTypeIdx].tag == TypeTag::Map) {
    return program.types[mapTypeIdx].map.key;
  }
  return atomTypeId(env, CoreTypeAtomId::String);
}

// --- Numeric coercion ------------------------------------------------------
//
// The device profile is f32 and every stored value is f32, so these bodies
// compute in `float` throughout. Native binary32 arithmetic is bit-identical to
// the reference VM's "compute in f64, then Math.fround" for + - * / % and sqrt
// (double rounding through binary64 is innocuous for binary32, since 53 >=
// 2*24+2), so float matches the contract without soft-float doubles on the M4F.
// Two cases cannot use float and are handled explicitly: ToInt32/ToUint32 need
// an exact 32-bit reduction that a 24-bit-mantissa float cannot round-trip, so
// they use integer bit manipulation; and Math.round must not lose the half-bit
// that `x + 0.5f` would round away.

/** True for IEEE NaN. */
bool isNan(float x) { return __builtin_isnan(x); }

/**
 * ECMAScript ToUint32 by exact integer reduction: the value truncated toward
 * zero, taken mod 2^32, as an unsigned 32-bit integer. NaN/Inf and `|x| < 1`
 * yield 0.
 */
uint32_t toUint32(float x) {
  uint32_t raw;
  memcpy(&raw, &x, sizeof(raw));
  const uint32_t exponent = (raw >> 23) & 0xff;
  const uint32_t mantissa = raw & 0x7fffff;
  if (exponent == 0xff || exponent == 0) {
    return 0; // NaN/Inf, or a subnormal/zero with |x| < 1
  }
  const int e = static_cast<int>(exponent) - 127;
  if (e < 0) {
    return 0; // |x| < 1 truncates to 0
  }
  const uint32_t significand = (1u << 23) | mantissa; // the 24-bit value
  uint32_t integral;
  if (e >= 23) {
    const int shift = e - 23;
    // An unsigned 32-bit shift already keeps only the low 32 bits (mod 2^32);
    // a shift of 32 or more leaves them all zero.
    integral = shift >= 32 ? 0u : (significand << shift);
  } else {
    integral = significand >> (23 - e); // drop the fractional bits
  }
  if ((raw >> 31) != 0) {
    integral = 0u - integral; // ToUint32 of a negative value wraps mod 2^32
  }
  return integral;
}

/** ECMAScript ToInt32: the ToUint32 bit pattern reinterpreted as signed. */
int32_t toInt32(float x) { return static_cast<int32_t>(toUint32(x)); }

/** ECMAScript ToInteger: NaN -> 0, otherwise truncate toward zero. */
float toInteger(float x) {
  if (isNan(x)) {
    return 0.0f;
  }
  return __builtin_truncf(x);
}

/** JS `Math.round`: round half toward +Infinity, preserving signed zero. */
float jsRound(float x) {
  if (isNan(x) || __builtin_isinf(x) || x == 0.0f) {
    return x;
  }
  // floor(x) plus one when the fraction reaches 0.5. `x - floor(x)` is exact
  // (Sterbenz), so the test does not lose the half-bit that `x + 0.5f` would.
  float r = __builtin_floorf(x);
  if (x - r >= 0.5f) {
    r += 1.0f;
  }
  // Inputs in (-0.5, 0) and -0.5 itself round to -0, not +0.
  if (r == 0.0f && x < 0.0f) {
    return -0.0f;
  }
  return r;
}

/** JS `Math.min`: NaN-propagating, -0 preferred over +0. */
float jsMin(float a, float b) {
  if (isNan(a) || isNan(b)) {
    return __builtin_nanf("");
  }
  if (a < b) {
    return a;
  }
  if (b < a) {
    return b;
  }
  if (a == 0.0f && b == 0.0f) {
    return (__builtin_signbit(a) || __builtin_signbit(b)) ? -0.0f : 0.0f;
  }
  return a;
}

/** JS `Math.max`: NaN-propagating, +0 preferred over -0. */
float jsMax(float a, float b) {
  if (isNan(a) || isNan(b)) {
    return __builtin_nanf("");
  }
  if (a > b) {
    return a;
  }
  if (b > a) {
    return b;
  }
  if (a == 0.0f && b == 0.0f) {
    return (!__builtin_signbit(a) || !__builtin_signbit(b)) ? 0.0f : -0.0f;
  }
  return a;
}

// --- Result helpers --------------------------------------------------------

Status okNumber(float value, Value& out) {
  out = Value::number(value);
  return Status::ok();
}

Status okBool(bool b, Value& out) {
  out = Value::boolean(b);
  return Status::ok();
}

Status okNil(Value& out) {
  out = kNilValue;
  return Status::ok();
}

// A required capability (heap or rng) was not supplied; mirrors the existing
// container opcodes' null-heap fault.
constexpr Status capabilityAbsent() { return Status::fail(ErrorCode::HostError); }
// A host-call failure surfaces as ScriptError per the VM contract (the HOST_CALL
// row): an id this dispatch cannot service (an id with no body).
constexpr Status unsupported() { return Status::fail(ErrorCode::ScriptError); }
constexpr Status heapFault() { return Status::fail(ErrorCode::StackOverflow); }

// --- Operand access (mirrors the TS `asValid*` guards) ---------------------

/** A finite-or-infinite, non-NaN number operand, mirroring `asValidNumber`. */
bool validNumber(Span<const Value> args, uint32_t i, float& out) {
  if (i >= args.size() || !args[i].isNumber()) {
    return false;
  }
  const float f = args[i].asNumber();
  if (isNan(f)) {
    return false;
  }
  out = f;
  return true;
}

/** A number operand read without the NaN guard. */
bool rawNumber(Span<const Value> args, uint32_t i, float& out) {
  if (i >= args.size() || !args[i].isNumber()) {
    return false;
  }
  out = args[i].asNumber();
  return true;
}

/** An optional number operand: absent (or nil) yields false, mirroring `optNum`. */
bool optNumber(Span<const Value> args, uint32_t i, float& out) {
  if (i >= args.size() || args[i].isNil() || !args[i].isNumber()) {
    return false;
  }
  out = args[i].asNumber();
  return true;
}

/** A boolean operand. */
bool boolArg(Span<const Value> args, uint32_t i, bool& out) {
  if (i >= args.size() || !args[i].isBoolean()) {
    return false;
  }
  out = args[i].asBoolean();
  return true;
}

/** Resolves a string operand's byte content through the heap. */
bool stringArg(const HostCallEnv& env, Span<const Value> args, uint32_t i, const char*& bytes,
               uint32_t& length) {
  if (env.heap == nullptr || i >= args.size() || !args[i].isString()) {
    return false;
  }
  return env.heap->stringContent(args[i], bytes, length);
}

// --- Byte-oriented string semantics (exact for the ASCII subset) -----------

bool asciiWhitespace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f';
}

/** Trims ASCII whitespace, yielding the kept byte range `[start, end)`. */
void trimRange(const char* bytes, uint32_t length, uint32_t& start, uint32_t& end) {
  start = 0;
  end = length;
  while (start < end && asciiWhitespace(bytes[start])) {
    start++;
  }
  while (end > start && asciiWhitespace(bytes[end - 1])) {
    end--;
  }
}

/** Clamps a slice endpoint: negative counts from the end, then clamp to [0, len]. */
uint32_t clampSlice(float v, uint32_t length) {
  if (v < 0) {
    v += static_cast<float>(length);
    if (v < 0) {
      v = 0;
    }
  } else if (v > static_cast<float>(length)) {
    v = static_cast<float>(length);
  }
  return static_cast<uint32_t>(v);
}

/** Clamps a substring endpoint to [0, len] (no negative-from-end). */
uint32_t clampSubstring(float v, uint32_t length) {
  if (v < 0) {
    return 0;
  }
  if (v > static_cast<float>(length)) {
    return length;
  }
  return static_cast<uint32_t>(v);
}

/** First index >= `from` (already clamped to `[0, hl]`) where `needle` occurs
 * in `hay`, or -1. */
int32_t byteIndexOf(const char* hay, uint32_t hl, const char* needle, uint32_t nl, uint32_t from) {
  if (nl == 0) {
    return static_cast<int32_t>(from);
  }
  if (nl > hl) {
    return -1;
  }
  for (uint32_t i = from; i + nl <= hl; i++) {
    if (memcmp(hay + i, needle, nl) == 0) {
      return static_cast<int32_t>(i);
    }
  }
  return -1;
}

/** Highest index <= `start` (already clamped to `[0, hl]`) where `needle`
 * occurs in `hay`, or -1. */
int32_t byteLastIndexOf(const char* hay, uint32_t hl, const char* needle, uint32_t nl,
                        uint32_t start) {
  if (nl == 0) {
    return static_cast<int32_t>(start);
  }
  if (nl > hl) {
    return -1;
  }
  uint32_t hi = start;
  if (hi > hl - nl) {
    hi = hl - nl; // hl >= nl here, so the difference does not underflow
  }
  for (uint32_t i = hi + 1; i-- > 0;) {
    if (memcmp(hay + i, needle, nl) == 0) {
      return static_cast<int32_t>(i);
    }
  }
  return -1;
}

/**
 * Parses a canonical array-index string ("0" or no-leading-zero digits) into
 * `out`, returning false when it is not one. A value too large to fit 32 bits
 * saturates to `0xffffffff`, which exceeds any container length, so the caller's
 * range check rejects it exactly as the original out-of-range value would.
 */
bool parseArrayIndexString(const char* bytes, uint32_t length, uint32_t& out) {
  if (length == 0) {
    return false;
  }
  uint32_t value = 0;
  for (uint32_t i = 0; i < length; i++) {
    const char c = bytes[i];
    if (c < '0' || c > '9') {
      return false;
    }
    if (i == 0 && length > 1 && c == '0') {
      return false;
    }
    if (value > (0xffffffffu - 9) / 10) {
      value = 0xffffffffu; // saturate: beyond any container length
      continue;
    }
    value = value * 10 + static_cast<uint32_t>(c - '0');
  }
  out = value;
  return true;
}

/** True for a non-negative finite integer array index. */
bool isArrayIndexNumber(float v) {
  return !isNan(v) && v >= 0 && __builtin_isfinite(v) && __builtin_floorf(v) == v;
}

/** Numeric value of a single hex digit char, or -1 when not a hex digit. */
int hexDigitValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

// --- String-producing helpers ----------------------------------------------

Status okString(const HostCallEnv& env, const char* bytes, uint32_t length, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  if (!env.heap->newString(bytes, length, env.roots, out)) {
    return heapFault();
  }
  return Status::ok();
}

/** Reconstructs a `String` value from a map key's string reference. */
Value mapKeyStringValue(const MapKey& key) {
  return key.isManagedString ? Value::managedString(key.stringRef)
                             : Value::borrowedString(key.stringRef);
}

// --- List/string element reads ---------------------------------------------

Status listGetBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  if (args.size() < 1 || !args[0].isList()) {
    return okNil(out);
  }
  const ListObject* list = env.heap->list(args[0]);
  if (args.size() < 2) {
    return okNil(out);
  }
  const Value& key = args[1];
  if (key.isNumber()) {
    const float v = key.asNumber();
    if (isArrayIndexNumber(v) && v < static_cast<float>(list->size)) {
      out = list->items[static_cast<uint32_t>(v)];
      return Status::ok();
    }
    return okNil(out);
  }
  if (key.isString()) {
    const char* kb = nullptr;
    uint32_t kl = 0;
    if (!env.heap->stringContent(key, kb, kl)) {
      return okNil(out);
    }
    if (kl == 6 && memcmp(kb, "length", 6) == 0) {
      return okNumber(static_cast<float>(list->size), out);
    }
    uint32_t idx = 0;
    if (parseArrayIndexString(kb, kl, idx) && idx < list->size) {
      out = list->items[idx];
      return Status::ok();
    }
    return okNil(out);
  }
  return okNil(out);
}

Status stringGetBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  const char* sb = nullptr;
  uint32_t sl = 0;
  if (args.size() < 1 || !stringArg(env, args, 0, sb, sl)) {
    return okNil(out);
  }
  if (args.size() < 2) {
    return okNil(out);
  }
  const Value& key = args[1];
  if (key.isNumber()) {
    const float v = key.asNumber();
    if (isArrayIndexNumber(v) && v < static_cast<float>(sl)) {
      return okString(env, sb + static_cast<uint32_t>(v), 1, out);
    }
    return okNil(out);
  }
  if (key.isString()) {
    const char* kb = nullptr;
    uint32_t kl = 0;
    if (!env.heap->stringContent(key, kb, kl)) {
      return okNil(out);
    }
    if (kl == 6 && memcmp(kb, "length", 6) == 0) {
      return okNumber(static_cast<float>(sl), out);
    }
    uint32_t idx = 0;
    if (parseArrayIndexString(kb, kl, idx) && idx < sl) {
      return okString(env, sb + idx, 1, out);
    }
    return okNil(out);
  }
  return okNil(out);
}

// --- Map builders -----------------------------------------------------------

Status mapKeysBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  if (args.size() < 1 || !args[0].isMap()) {
    return unsupported();
  }
  ManagedHeap& heap = *env.heap;
  const MapObject* map = heap.map(args[0]);
  const uint32_t size = map->size;
  const uint32_t resultType = listTypeId(env, mapKeyElementType(env, args[0]));
  Value listVal;
  if (!heap.newList(resultType, env.roots, listVal)) {
    return heapFault();
  }
  ManagedHeap::Pin pin(heap, listVal);
  ListObject* list = heap.list(listVal);
  // Reserve up front so each append never allocates (and never collects).
  if (!heap.listReserve(list, size, env.roots)) {
    return heapFault();
  }
  for (uint32_t i = 0; i < size; i++) {
    const MapEntry& entry = heap.map(args[0])->entries[i];
    Value element;
    if (entry.key.isNumber) {
      element = Value::number(entry.key.number);
    } else {
      const char* kb = nullptr;
      uint32_t kl = 0;
      if (!heap.stringContent(mapKeyStringValue(entry.key), kb, kl)) {
        return unsupported();
      }
      if (!heap.newString(kb, kl, env.roots, element)) {
        return heapFault();
      }
    }
    if (!heap.listPush(heap.list(listVal), element, env.roots)) {
      return heapFault();
    }
  }
  out = listVal;
  return Status::ok();
}

Status mapValuesBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  if (args.size() < 1 || !args[0].isMap()) {
    return unsupported();
  }
  ManagedHeap& heap = *env.heap;
  const uint32_t size = heap.map(args[0])->size;
  const uint32_t resultType = listTypeId(env, atomTypeId(env, CoreTypeAtomId::Any));
  Value listVal;
  if (!heap.newList(resultType, env.roots, listVal)) {
    return heapFault();
  }
  ManagedHeap::Pin pin(heap, listVal);
  if (!heap.listReserve(heap.list(listVal), size, env.roots)) {
    return heapFault();
  }
  for (uint32_t i = 0; i < size; i++) {
    const Value element = heap.map(args[0])->entries[i].value;
    if (!heap.listPush(heap.list(listVal), element, env.roots)) {
      return heapFault();
    }
  }
  out = listVal;
  return Status::ok();
}

Status mapSizeBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  if (args.size() < 1 || !args[0].isMap()) {
    return unsupported();
  }
  return okNumber(static_cast<float>(env.heap->map(args[0])->size), out);
}

Status mapClearBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  if (args.size() < 1 || !args[0].isMap()) {
    return unsupported();
  }
  // Mirror `Dict.clear`: drop the entries (so their values become collectable)
  // and return the same map.
  env.heap->map(args[0])->size = 0;
  out = args[0];
  return Status::ok();
}

// --- String builtins --------------------------------------------------------

Status strConcatBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  const char* first = nullptr;
  uint32_t firstLen = 0;
  if (args.size() < 1 || !stringArg(env, args, 0, first, firstLen)) {
    return unsupported();
  }
  // Size the result to the total of arg0 plus each non-nil string arg, then
  // fill it directly (no scratch buffer).
  uint32_t total = firstLen;
  for (uint32_t i = 1; i < args.size(); i++) {
    if (args[i].isNil()) {
      continue;
    }
    const char* b = nullptr;
    uint32_t l = 0;
    if (!env.heap->stringContent(args[i], b, l)) {
      return unsupported();
    }
    total += l;
  }
  Value result;
  char* dst = nullptr;
  if (!env.heap->allocString(total, env.roots, result, dst)) {
    return heapFault();
  }
  // The source operands stay rooted (operand stack) across allocString, and
  // managed strings never relocate, so their content pointers are re-fetched
  // here and remain valid.
  uint32_t offset = 0;
  const char* b0 = nullptr;
  uint32_t l0 = 0;
  env.heap->stringContent(args[0], b0, l0);
  memcpy(dst, b0, l0);
  offset += l0;
  for (uint32_t i = 1; i < args.size(); i++) {
    if (args[i].isNil()) {
      continue;
    }
    const char* b = nullptr;
    uint32_t l = 0;
    env.heap->stringContent(args[i], b, l);
    memcpy(dst + offset, b, l);
    offset += l;
  }
  out = result;
  return Status::ok();
}

/** Counts the parts a split produces, capped at `limitCap`. */
uint32_t splitCount(const char* src, uint32_t sl, const char* sep, uint32_t sepLen,
                    uint32_t limitCap) {
  if (limitCap == 0) {
    return 0;
  }
  if (sepLen == 0) {
    return sl < limitCap ? sl : limitCap;
  }
  uint32_t count = 0;
  uint32_t start = 0;
  while (true) {
    const int32_t pos = byteIndexOf(src, sl, sep, sepLen, start);
    count++;
    if (pos < 0) {
      break;
    }
    start = static_cast<uint32_t>(pos) + sepLen;
  }
  return count < limitCap ? count : limitCap;
}

Status strSplitBody(const HostCallEnv& env, Span<const Value> args, Value& out) {
  if (env.heap == nullptr) {
    return capabilityAbsent();
  }
  const char* src = nullptr;
  uint32_t sl = 0;
  const char* sep = nullptr;
  uint32_t sepLen = 0;
  if (!stringArg(env, args, 0, src, sl) || !stringArg(env, args, 1, sep, sepLen)) {
    return unsupported();
  }
  float limitD = 0;
  const uint32_t limitCap = optNumber(args, 2, limitD) ? toUint32(limitD) : 0xffffffffu;
  const uint32_t count = splitCount(src, sl, sep, sepLen, limitCap);

  ManagedHeap& heap = *env.heap;
  const uint32_t resultType = listTypeId(env, atomTypeId(env, CoreTypeAtomId::String));
  Value listVal;
  if (!heap.newList(resultType, env.roots, listVal)) {
    return heapFault();
  }
  ManagedHeap::Pin pin(heap, listVal);
  if (!heap.listReserve(heap.list(listVal), count, env.roots)) {
    return heapFault();
  }
  // Source/separator are rooted operands and never relocate, so the pointers
  // captured above stay valid across the element allocations below.
  uint32_t produced = 0;
  if (sepLen == 0) {
    for (uint32_t i = 0; i < sl && produced < count; i++) {
      Value part;
      if (!heap.newString(src + i, 1, env.roots, part)) {
        return heapFault();
      }
      if (!heap.listPush(heap.list(listVal), part, env.roots)) {
        return heapFault();
      }
      produced++;
    }
  } else {
    uint32_t start = 0;
    while (produced < count) {
      const int32_t pos = byteIndexOf(src, sl, sep, sepLen, start);
      const uint32_t end = pos < 0 ? sl : static_cast<uint32_t>(pos);
      Value part;
      if (!heap.newString(src + start, end - start, env.roots, part)) {
        return heapFault();
      }
      if (!heap.listPush(heap.list(listVal), part, env.roots)) {
        return heapFault();
      }
      produced++;
      if (pos < 0) {
        break;
      }
      start = static_cast<uint32_t>(pos) + sepLen;
    }
  }
  out = listVal;
  return Status::ok();
}

} // namespace

Status callCoreHostFunction(CoreFuncId id, Span<const Value> args, const HostCallEnv& env,
                            Value& out) {
  float a = 0;
  float b = 0;
  bool ba = false;
  bool bb = false;
  const char* sa = nullptr;
  uint32_t la = 0;
  const char* sb = nullptr;
  uint32_t lb = 0;

  switch (id) {
  // --- Boolean operators ---
  case CoreFuncId::OpAndBoolean:
    return (boolArg(args, 0, ba) && boolArg(args, 1, bb)) ? okBool(ba && bb, out) : unsupported();
  case CoreFuncId::OpOrBoolean:
    return (boolArg(args, 0, ba) && boolArg(args, 1, bb)) ? okBool(ba || bb, out) : unsupported();
  case CoreFuncId::OpNotBoolean:
    return boolArg(args, 0, ba) ? okBool(!ba, out) : unsupported();
  case CoreFuncId::OpEqualToBoolean:
    return (boolArg(args, 0, ba) && boolArg(args, 1, bb)) ? okBool(ba == bb, out) : unsupported();
  case CoreFuncId::OpNotEqualToBoolean:
    return (boolArg(args, 0, ba) && boolArg(args, 1, bb)) ? okBool(ba != bb, out) : unsupported();

  // --- Arithmetic (nil on bad operand or NaN result) ---
  case CoreFuncId::OpAddNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return isNan(a + b) ? okNil(out) : okNumber(a + b, out);
  case CoreFuncId::OpSubtractNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return isNan(a - b) ? okNil(out) : okNumber(a - b, out);
  case CoreFuncId::OpMultiplyNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return isNan(a * b) ? okNil(out) : okNumber(a * b, out);
  case CoreFuncId::OpDivideNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b) || b == 0.0f) {
      return okNil(out);
    }
    return isNan(a / b) ? okNil(out) : okNumber(a / b, out);
  case CoreFuncId::OpModuloNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b) || b == 0.0f) {
      return okNil(out);
    }
    return isNan(__builtin_fmodf(a, b)) ? okNil(out) : okNumber(__builtin_fmodf(a, b), out);
  case CoreFuncId::OpNegateNumber:
    return validNumber(args, 0, a) ? okNumber(-a, out) : okNil(out);

  // --- Bitwise (ToInt32-coerced; the i32 result rounds to profile precision) ---
  case CoreFuncId::OpBitwiseAndNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return okNumber(static_cast<float>(toInt32(a) & toInt32(b)), out);
  case CoreFuncId::OpBitwiseOrNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return okNumber(static_cast<float>(toInt32(a) | toInt32(b)), out);
  case CoreFuncId::OpBitwiseXorNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return okNumber(static_cast<float>(toInt32(a) ^ toInt32(b)), out);
  case CoreFuncId::OpBitwiseNotNumber:
    return validNumber(args, 0, a) ? okNumber(static_cast<float>(~toInt32(a)), out) : okNil(out);
  case CoreFuncId::OpLeftShiftNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return okNumber(static_cast<float>(static_cast<int32_t>(static_cast<uint32_t>(toInt32(a))
                                                            << (toUint32(b) & 31u))),
                    out);
  case CoreFuncId::OpRightShiftNumber:
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    return okNumber(static_cast<float>(toInt32(a) >> (toUint32(b) & 31u)), out);

  // --- Numeric comparisons (false on bad operand) ---
  case CoreFuncId::OpEqualToNumber:
    return (validNumber(args, 0, a) && validNumber(args, 1, b)) ? okBool(a == b, out)
                                                                : okBool(false, out);
  case CoreFuncId::OpNotEqualToNumber:
    return (validNumber(args, 0, a) && validNumber(args, 1, b)) ? okBool(a != b, out)
                                                                : okBool(false, out);
  case CoreFuncId::OpLessThanNumber:
    return (validNumber(args, 0, a) && validNumber(args, 1, b)) ? okBool(a < b, out)
                                                                : okBool(false, out);
  case CoreFuncId::OpLessThanOrEqualToNumber:
    return (validNumber(args, 0, a) && validNumber(args, 1, b)) ? okBool(a <= b, out)
                                                                : okBool(false, out);
  case CoreFuncId::OpGreaterThanNumber:
    return (validNumber(args, 0, a) && validNumber(args, 1, b)) ? okBool(a > b, out)
                                                                : okBool(false, out);
  case CoreFuncId::OpGreaterThanOrEqualToNumber:
    return (validNumber(args, 0, a) && validNumber(args, 1, b)) ? okBool(a >= b, out)
                                                                : okBool(false, out);

  // --- String operators ---
  case CoreFuncId::OpAddString:
    if (!stringArg(env, args, 0, sa, la) || !stringArg(env, args, 1, sb, lb)) {
      return okNil(out);
    }
    return strConcatBody(env, args, out); // arg0 + arg1, sized and filled directly
  case CoreFuncId::OpEqualToString:
    if (!stringArg(env, args, 0, sa, la) || !stringArg(env, args, 1, sb, lb)) {
      return okBool(false, out);
    }
    return okBool(la == lb && (la == 0 || memcmp(sa, sb, la) == 0), out);
  case CoreFuncId::OpNotEqualToString:
    if (!stringArg(env, args, 0, sa, la) || !stringArg(env, args, 1, sb, lb)) {
      return okBool(false, out);
    }
    return okBool(!(la == lb && (la == 0 || memcmp(sa, sb, la) == 0)), out);

  // --- Nil comparisons (pure tag checks) ---
  case CoreFuncId::OpEqualToNil:
    return okBool(true, out);
  case CoreFuncId::OpNotEqualToNil:
    return okBool(false, out);
  case CoreFuncId::OpNotNil:
    return okBool(true, out);
  case CoreFuncId::OpEqualToNumberNil:
  case CoreFuncId::OpEqualToBooleanNil:
  case CoreFuncId::OpEqualToStringNil:
    return okBool(args.size() > 0 && args[0].isNil(), out);
  case CoreFuncId::OpEqualToNilNumber:
  case CoreFuncId::OpEqualToNilBoolean:
  case CoreFuncId::OpEqualToNilString:
    return okBool(args.size() > 1 && args[1].isNil(), out);
  case CoreFuncId::OpNotEqualToNumberNil:
  case CoreFuncId::OpNotEqualToBooleanNil:
  case CoreFuncId::OpNotEqualToStringNil:
    return okBool(!(args.size() > 0 && args[0].isNil()), out);
  case CoreFuncId::OpNotEqualToNilNumber:
  case CoreFuncId::OpNotEqualToNilBoolean:
  case CoreFuncId::OpNotEqualToNilString:
    return okBool(!(args.size() > 1 && args[1].isNil()), out);

  // --- Enum comparisons (symbol identity; false on bad operands) ---
  case CoreFuncId::OpEqualToEnum: {
    const bool comparable = args.size() > 1 && args[0].tag() == ValueTag::Enum &&
                            args[1].tag() == ValueTag::Enum && args[0].typeId() == args[1].typeId();
    return okBool(comparable && args[0].enumOrdinal() == args[1].enumOrdinal(), out);
  }
  case CoreFuncId::OpNotEqualToEnum: {
    const bool comparable = args.size() > 1 && args[0].tag() == ValueTag::Enum &&
                            args[1].tag() == ValueTag::Enum && args[0].typeId() == args[1].typeId();
    return okBool(comparable && args[0].enumOrdinal() != args[1].enumOrdinal(), out);
  }

  // --- Conversions ---
  case CoreFuncId::ConvNumberToBoolean:
    return rawNumber(args, 0, a) ? okBool(a != 0.0f, out) : unsupported();
  case CoreFuncId::ConvBooleanToNumber:
    return boolArg(args, 0, ba) ? okNumber(ba ? 1.0f : 0.0f, out) : unsupported();
  case CoreFuncId::ConvStringToBoolean: {
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    uint32_t s = 0;
    uint32_t e = 0;
    trimRange(sa, la, s, e);
    return okBool(e > s, out);
  }
  case CoreFuncId::ConvBooleanToString:
    if (!boolArg(args, 0, ba)) {
      return unsupported();
    }
    return ba ? okString(env, "true", 4, out) : okString(env, "false", 5, out);

  // --- Element access ---
  case CoreFuncId::ListGet:
    return listGetBody(env, args, out);
  case CoreFuncId::StringGet:
    return stringGetBody(env, args, out);

  // --- Map builtins ---
  case CoreFuncId::MapKeys:
    return mapKeysBody(env, args, out);
  case CoreFuncId::MapValues:
    return mapValuesBody(env, args, out);
  case CoreFuncId::MapSize:
    return mapSizeBody(env, args, out);
  case CoreFuncId::MapClear:
    return mapClearBody(env, args, out);

  // --- Math builtins (exact) ---
  case CoreFuncId::MathAbs:
    return rawNumber(args, 0, a) ? okNumber(__builtin_fabsf(a), out) : unsupported();
  case CoreFuncId::MathCeil:
    return rawNumber(args, 0, a) ? okNumber(__builtin_ceilf(a), out) : unsupported();
  case CoreFuncId::MathFloor:
    return rawNumber(args, 0, a) ? okNumber(__builtin_floorf(a), out) : unsupported();
  case CoreFuncId::MathRound:
    return rawNumber(args, 0, a) ? okNumber(jsRound(a), out) : unsupported();
  case CoreFuncId::MathMax:
    return (rawNumber(args, 0, a) && rawNumber(args, 1, b)) ? okNumber(jsMax(a, b), out)
                                                            : unsupported();
  case CoreFuncId::MathMin:
    return (rawNumber(args, 0, a) && rawNumber(args, 1, b)) ? okNumber(jsMin(a, b), out)
                                                            : unsupported();
  case CoreFuncId::MathSqrt:
    return rawNumber(args, 0, a) ? okNumber(__builtin_sqrtf(a), out) : unsupported();
  case CoreFuncId::MathRandom:
    if (env.rng == nullptr) {
      return capabilityAbsent();
    }
    out = Value::number(env.rng->next());
    return Status::ok();

  // --- String builtins ---
  case CoreFuncId::StrLength:
    return stringArg(env, args, 0, sa, la) ? okNumber(static_cast<float>(la), out) : unsupported();
  case CoreFuncId::StrCharAt: {
    if (!stringArg(env, args, 0, sa, la) || !rawNumber(args, 1, a)) {
      return unsupported();
    }
    const float n = toInteger(a);
    if (n >= 0 && n < static_cast<float>(la)) {
      return okString(env, sa + static_cast<uint32_t>(n), 1, out);
    }
    return okString(env, "", 0, out);
  }
  case CoreFuncId::StrCharCodeAt: {
    if (!stringArg(env, args, 0, sa, la) || !rawNumber(args, 1, a)) {
      return unsupported();
    }
    const float n = toInteger(a);
    if (n >= 0 && n < static_cast<float>(la)) {
      return okNumber(static_cast<unsigned char>(sa[static_cast<uint32_t>(n)]), out);
    }
    return okNumber(__builtin_nanf(""), out);
  }
  case CoreFuncId::StrIndexOf: {
    if (!stringArg(env, args, 0, sa, la) || !stringArg(env, args, 1, sb, lb)) {
      return unsupported();
    }
    float posD = 0;
    // Clamp the position to [0, length] in float before indexing; the operand
    // can be any magnitude, so a direct cast to an integer could overflow it.
    const uint32_t from = optNumber(args, 2, posD) ? clampSubstring(toInteger(posD), la) : 0;
    return okNumber(static_cast<float>(byteIndexOf(sa, la, sb, lb, from)), out);
  }
  case CoreFuncId::StrLastIndexOf: {
    if (!stringArg(env, args, 0, sa, la) || !stringArg(env, args, 1, sb, lb)) {
      return unsupported();
    }
    float posD = 0;
    uint32_t start = la;
    if (optNumber(args, 2, posD)) {
      // ECMAScript: a NaN position means search from the end (+Infinity).
      start = isNan(posD) ? la : clampSubstring(toInteger(posD), la);
    }
    return okNumber(static_cast<float>(byteLastIndexOf(sa, la, sb, lb, start)), out);
  }
  case CoreFuncId::StrSlice: {
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    float startD = 0;
    float endD = 0;
    const uint32_t s = optNumber(args, 1, startD) ? clampSlice(toInteger(startD), la) : 0;
    const uint32_t e = optNumber(args, 2, endD) ? clampSlice(toInteger(endD), la) : la;
    return s < e ? okString(env, sa + s, e - s, out) : okString(env, "", 0, out);
  }
  case CoreFuncId::StrSubstring: {
    if (!stringArg(env, args, 0, sa, la) || !rawNumber(args, 1, a)) {
      return unsupported();
    }
    float endD = 0;
    uint32_t s = clampSubstring(toInteger(a), la);
    uint32_t e = optNumber(args, 2, endD) ? clampSubstring(toInteger(endD), la) : la;
    if (s > e) {
      const uint32_t t = s;
      s = e;
      e = t;
    }
    return okString(env, sa + s, e - s, out);
  }
  case CoreFuncId::StrToLowerCase: {
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    Value result;
    char* dst = nullptr;
    if (!env.heap->allocString(la, env.roots, result, dst)) {
      return heapFault();
    }
    env.heap->stringContent(args[0], sa, la); // re-fetch after possible collection
    for (uint32_t i = 0; i < la; i++) {
      const char c = sa[i];
      dst[i] = (c >= 'A' && c <= 'Z') ? static_cast<char>(c + 32) : c;
    }
    out = result;
    return Status::ok();
  }
  case CoreFuncId::StrToUpperCase: {
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    Value result;
    char* dst = nullptr;
    if (!env.heap->allocString(la, env.roots, result, dst)) {
      return heapFault();
    }
    env.heap->stringContent(args[0], sa, la);
    for (uint32_t i = 0; i < la; i++) {
      const char c = sa[i];
      dst[i] = (c >= 'a' && c <= 'z') ? static_cast<char>(c - 32) : c;
    }
    out = result;
    return Status::ok();
  }
  case CoreFuncId::StrTrim: {
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    uint32_t s = 0;
    uint32_t e = 0;
    trimRange(sa, la, s, e);
    return okString(env, sa + s, e - s, out);
  }
  case CoreFuncId::StrSplit:
    return strSplitBody(env, args, out);
  case CoreFuncId::StrConcat:
    return strConcatBody(env, args, out);

  // --- Buffer builtins (immutable raw bytes 0-255) ---
  case CoreFuncId::BufferFrom: {
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    const bool hasList = args.size() >= 1 && args[0].isList();
    const uint32_t n = hasList ? env.heap->list(args[0])->size : 0;
    Value result;
    uint8_t* dst = nullptr;
    if (!env.heap->allocBuffer(n, env.roots, result, dst)) {
      return heapFault();
    }
    if (hasList) {
      const ListObject* list = env.heap->list(args[0]); // re-resolve after a possible collection
      for (uint32_t i = 0; i < n; i++) {
        const Value& item = list->items[i];
        dst[i] = item.isNumber()
                     ? static_cast<uint8_t>(static_cast<uint32_t>(toInt32(item.asNumber())) & 0xffu)
                     : 0;
      }
    }
    out = result;
    return Status::ok();
  }
  case CoreFuncId::BufferFromHex: {
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    if (!stringArg(env, args, 0, sa, la) || (la & 1u) != 0) {
      return unsupported();
    }
    for (uint32_t i = 0; i < la; i++) {
      if (hexDigitValue(sa[i]) < 0) {
        return unsupported();
      }
    }
    const uint32_t n = la / 2;
    Value result;
    uint8_t* dst = nullptr;
    if (!env.heap->allocBuffer(n, env.roots, result, dst)) {
      return heapFault();
    }
    if (!stringArg(env, args, 0, sa, la)) { // re-resolve after a possible collection
      return unsupported();
    }
    for (uint32_t i = 0; i < n; i++) {
      const int hi = hexDigitValue(sa[2 * i]);
      const int lo = hexDigitValue(sa[2 * i + 1]);
      dst[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    out = result;
    return Status::ok();
  }
  case CoreFuncId::BufferFromString: {
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    Value result;
    uint8_t* dst = nullptr;
    if (!env.heap->allocBuffer(la, env.roots, result, dst)) {
      return heapFault();
    }
    if (!stringArg(env, args, 0, sa, la)) { // re-resolve after a possible collection
      return unsupported();
    }
    if (la > 0) {
      memcpy(dst, sa, la);
    }
    out = result;
    return Status::ok();
  }
  case CoreFuncId::BufferLength:
    if (args.size() < 1 || !args[0].isBuffer()) {
      return unsupported();
    }
    return okNumber(static_cast<float>(args[0].bufferLength()), out);
  case CoreFuncId::BufferGet: {
    if (args.size() < 2 || !args[0].isBuffer() || !rawNumber(args, 1, a)) {
      return unsupported();
    }
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    const uint8_t* bytes = nullptr;
    uint32_t length = 0;
    if (!env.heap->bufferContent(args[0], bytes, length)) {
      return okNil(out);
    }
    const float n = toInteger(a);
    if (n >= 0 && n < static_cast<float>(length)) {
      return okNumber(static_cast<float>(bytes[static_cast<uint32_t>(n)]), out);
    }
    return okNil(out);
  }

  // --- Power operator (nil on bad operand or NaN result) ---
  case CoreFuncId::OpPowerNumber: {
    if (!validNumber(args, 0, a) || !validNumber(args, 1, b)) {
      return okNil(out);
    }
    const float r = binary32::pow(a, b);
    return isNan(r) ? okNil(out) : okNumber(r, out);
  }

  // --- Number <-> string (shortest-round-trip f32 / parseFloat) ---
  case CoreFuncId::ConvNumberToString: {
    if (!rawNumber(args, 0, a)) {
      return unsupported();
    }
    if (env.heap == nullptr) {
      return capabilityAbsent();
    }
    char buffer[32];
    const uint32_t length = binary32::formatNumber(a, buffer);
    return okString(env, buffer, length, out);
  }
  case CoreFuncId::ConvStringToNumber: {
    if (!stringArg(env, args, 0, sa, la)) {
      return unsupported();
    }
    const float v = binary32::parseNumber(sa, la);
    return okNumber(isNan(v) ? 0.0f : v, out);
  }

  // --- Transcendental math builtins (f32; NaN result passes through) ---
  case CoreFuncId::MathAcos:
    return rawNumber(args, 0, a) ? okNumber(binary32::acos(a), out) : unsupported();
  case CoreFuncId::MathAsin:
    return rawNumber(args, 0, a) ? okNumber(binary32::asin(a), out) : unsupported();
  case CoreFuncId::MathAtan:
    return rawNumber(args, 0, a) ? okNumber(binary32::atan(a), out) : unsupported();
  case CoreFuncId::MathAtan2:
    return (rawNumber(args, 0, a) && rawNumber(args, 1, b)) ? okNumber(binary32::atan2(a, b), out)
                                                            : unsupported();
  case CoreFuncId::MathCos:
    return rawNumber(args, 0, a) ? okNumber(binary32::cos(a), out) : unsupported();
  case CoreFuncId::MathExp:
    return rawNumber(args, 0, a) ? okNumber(binary32::exp(a), out) : unsupported();
  case CoreFuncId::MathLog:
    return rawNumber(args, 0, a) ? okNumber(binary32::log(a), out) : unsupported();
  case CoreFuncId::MathPow:
    return (rawNumber(args, 0, a) && rawNumber(args, 1, b)) ? okNumber(binary32::pow(a, b), out)
                                                            : unsupported();
  case CoreFuncId::MathSin:
    return rawNumber(args, 0, a) ? okNumber(binary32::sin(a), out) : unsupported();
  case CoreFuncId::MathTan:
    return rawNumber(args, 0, a) ? okNumber(binary32::tan(a), out) : unsupported();

  // --- Context/sensor/actuator ids: not core host-call bodies ---
  default:
    return unsupported();
  }
}

} // namespace mindcraft
