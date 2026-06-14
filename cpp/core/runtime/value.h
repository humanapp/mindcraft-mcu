#pragma once

#include <cstdint>
#include <type_traits>

#include "core/runtime/error-code.h"
#include "core/runtime/mc-number.h"

namespace mindcraft {

/**
 * Runtime type tag of a {@link Value}. The visible-type members mirror the
 * NativeType enum in
 * external/mindcraft-lang/packages/core/src/runtime/type-defs.ts and are
 * contract-stable: `TYPE_CHECK` compares a value's tag against a `NativeType`
 * instruction operand, so these numbers must match the TS values exactly.
 * `Handle` and `Err` are VM-internal values; their tags sit outside the
 * `NativeType` range so a `TYPE_CHECK` against them always compares false.
 */
enum class ValueTag : int8_t {
  Unknown = -1,
  Void = 0,
  Nil = 1,
  Boolean = 2,
  Number = 3,
  String = 4,
  Enum = 5,
  List = 6,
  Map = 7,
  Struct = 8,
  Function = 11,
  Handle = 100,
  Err = 101,
};

/** Sentinel captures reference marking a function value with no capture list. */
inline constexpr uint32_t kNoCaptures = 0xffffffffu;

/**
 * Flag bit reserved in a string reference to distinguish managed (dynamically
 * created, collectable) strings from borrowed (constant-pool, never freed)
 * strings. The runtime currently creates only borrowed references, so the bit
 * is always clear; managed strings set it when the dynamic-string pool lands.
 */
inline constexpr uint32_t kManagedStringRefBit = 0x80000000u;

/** Mask selecting the pool index bits of a string reference. */
inline constexpr uint32_t kStringRefIndexMask = 0x7fffffffu;

/**
 * Brain runtime value: a small trivially-copyable tagged union. Mirrors the
 * Value union in external/mindcraft-lang/packages/core/src/runtime/value.ts.
 * Inline kinds (numbers, booleans, the singletons, enum ordinals, function
 * references) carry their payload directly; reference kinds carry a pool
 * index or handle, never a pointer. Construct values through the static
 * factories and read payloads through the accessors; each accessor requires
 * the matching {@link tag}.
 */
class Value {
public:
  /** Payload of an `Enum`, `List`, `Map`, or `Struct` value. */
  struct Compound {
    /** Type-table index of the value's type. */
    uint32_t typeId;
    /** Enum: symbol ordinal. List/Map/Struct: container pool handle. */
    uint32_t ref;
  };

  /** Payload of a `Function` value. */
  struct Function {
    /** FuncId of the referenced function. */
    uint32_t funcId;
    /** Captures handle, or {@link kNoCaptures} when the value carries none. */
    uint32_t captures;
  };

  /** A `Nil` value. */
  constexpr Value() : tag_(ValueTag::Nil), payload_() {}

  /** The `Unknown` singleton. */
  static constexpr Value unknown() { return Value(ValueTag::Unknown, Payload()); }

  /** The `Void` singleton. */
  static constexpr Value voidValue() { return Value(ValueTag::Void, Payload()); }

  /** The `Nil` singleton. */
  static constexpr Value nil() { return Value(ValueTag::Nil, Payload()); }

  /** A `Boolean` value. */
  static constexpr Value boolean(bool value) { return Value(ValueTag::Boolean, Payload(value)); }

  /** A `Number` value at the profile's precision. */
  static constexpr Value number(mc_number_t value) {
    return Value(ValueTag::Number, Payload(value));
  }

  /**
   * A `String` value borrowing constant-pool entry `stringIdx` (a program
   * string-table index). Requires `stringIdx` to fit {@link
   * kStringRefIndexMask}.
   */
  static constexpr Value borrowedString(uint32_t stringIdx) {
    return Value(ValueTag::String, Payload(stringIdx));
  }

  /** An `Enum` value: type-table index plus declared-symbol ordinal. */
  static constexpr Value enumSymbol(uint32_t typeId, uint32_t ordinal) {
    return Value(ValueTag::Enum, Payload(Compound{typeId, ordinal}));
  }

  /** A `List` value: its type-table index plus the managed-heap handle. */
  static constexpr Value list(uint32_t typeId, uint32_t handle) {
    return Value(ValueTag::List, Payload(Compound{typeId, handle}));
  }

  /** A `Map` value: its type-table index plus the managed-heap handle. */
  static constexpr Value map(uint32_t typeId, uint32_t handle) {
    return Value(ValueTag::Map, Payload(Compound{typeId, handle}));
  }

  /** A `Function` value, optionally carrying a captures handle. */
  static constexpr Value function(uint32_t funcId, uint32_t captures = kNoCaptures) {
    return Value(ValueTag::Function, Payload(Function{funcId, captures}));
  }

  /** A VM-internal `Handle` value referencing a pending async operation. */
  static constexpr Value handle(uint32_t handleId) {
    return Value(ValueTag::Handle, Payload(handleId));
  }

  /** A VM-internal `Err` value carrying a fault classifier. */
  static constexpr Value error(ErrorCode code) {
    return Value(ValueTag::Err, Payload(static_cast<uint16_t>(code)));
  }

  /** The value's runtime type tag. */
  constexpr ValueTag tag() const { return tag_; }

  /** True when the tag is `Boolean`. */
  constexpr bool isBoolean() const { return tag_ == ValueTag::Boolean; }

  /** True when the tag is `Number`. */
  constexpr bool isNumber() const { return tag_ == ValueTag::Number; }

  /** True when the tag is `String`. */
  constexpr bool isString() const { return tag_ == ValueTag::String; }

  /** True when the tag is `Nil`. */
  constexpr bool isNil() const { return tag_ == ValueTag::Nil; }

  /** True when the tag is `List`. */
  constexpr bool isList() const { return tag_ == ValueTag::List; }

  /** True when the tag is `Map`. */
  constexpr bool isMap() const { return tag_ == ValueTag::Map; }

  /** The boolean payload. Requires tag `Boolean`. */
  constexpr bool asBoolean() const { return payload_.boolean; }

  /** The numeric payload. Requires tag `Number`. */
  constexpr mc_number_t asNumber() const { return payload_.num; }

  /**
   * The raw string reference, including the {@link kManagedStringRefBit}
   * flag. Requires tag `String`.
   */
  constexpr uint32_t stringRef() const { return payload_.ref; }

  /**
   * The string-table index of a borrowed string reference. Requires tag
   * `String` and a borrowed reference (the only kind this runtime creates).
   */
  constexpr uint32_t borrowedStringIndex() const { return payload_.ref & kStringRefIndexMask; }

  /** The type-table index. Requires tag `Enum`, `List`, `Map`, or `Struct`. */
  constexpr uint32_t typeId() const { return payload_.compound.typeId; }

  /**
   * The managed-heap handle of a container value. Requires tag `List` or
   * `Map`.
   */
  constexpr uint32_t containerHandle() const { return payload_.compound.ref; }

  /** The declared-symbol ordinal. Requires tag `Enum`. */
  constexpr uint32_t enumOrdinal() const { return payload_.compound.ref; }

  /** The referenced funcId. Requires tag `Function`. */
  constexpr uint32_t functionId() const { return payload_.fn.funcId; }

  /**
   * The captures handle, or {@link kNoCaptures} when absent. Requires tag
   * `Function`.
   */
  constexpr uint32_t functionCaptures() const { return payload_.fn.captures; }

  /** The async handle id. Requires tag `Handle`. */
  constexpr uint32_t handleId() const { return payload_.ref; }

  /** The fault classifier. Requires tag `Err`. */
  constexpr ErrorCode errorCode() const { return static_cast<ErrorCode>(payload_.errCode); }

private:
  union Payload {
    constexpr Payload() : num(0.0f) {}
    constexpr explicit Payload(mc_number_t value) : num(value) {}
    constexpr explicit Payload(bool value) : boolean(value) {}
    constexpr explicit Payload(uint32_t value) : ref(value) {}
    constexpr explicit Payload(uint16_t value) : errCode(value) {}
    constexpr explicit Payload(Compound value) : compound(value) {}
    constexpr explicit Payload(Function value) : fn(value) {}

    mc_number_t num;
    bool boolean;
    uint32_t ref;
    uint16_t errCode;
    Compound compound;
    Function fn;
  };

  constexpr Value(ValueTag tag, Payload payload) : tag_(tag), payload_(payload) {}

  ValueTag tag_;
  Payload payload_;
};

/** Pooled `Unknown` singleton. */
inline constexpr Value kUnknownValue = Value::unknown();
/** Pooled `Void` singleton. */
inline constexpr Value kVoidValue = Value::voidValue();
/** Pooled `Nil` singleton. */
inline constexpr Value kNilValue = Value::nil();
/** Pooled `Boolean` singleton for `true`. */
inline constexpr Value kTrueValue = Value::boolean(true);
/** Pooled `Boolean` singleton for `false`. */
inline constexpr Value kFalseValue = Value::boolean(false);

static_assert(std::is_trivially_copyable_v<Value>, "Value stays trivially copyable");
static_assert(sizeof(Value) <= 16, "Value stays within the locked layout budget");

} // namespace mindcraft
