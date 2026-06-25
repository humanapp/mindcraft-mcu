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
  Buffer = 12,
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
 * Flag bit reserved in a buffer reference to distinguish a managed (host-
 * constructed, collectable) buffer from a borrowed (constant-pool, never freed)
 * buffer. A managed buffer sets it in its handle word; a borrowed buffer's byte
 * offset leaves it clear.
 */
inline constexpr uint32_t kManagedBufferRefBit = 0x80000000u;

/** Mask selecting the handle/offset bits of a buffer reference. */
inline constexpr uint32_t kBufferRefIndexMask = 0x7fffffffu;

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

  /** Payload of a borrowed `Buffer` value. */
  struct BufferRef {
    /** Byte offset of the buffer's first byte in the program image's borrowed bytes. */
    uint32_t byteOffset;
    /** Number of bytes. */
    uint32_t byteCount;
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

  /**
   * A `String` value referencing managed-heap string object `handle` (a
   * dynamically created, collectable string). The {@link kManagedStringRefBit}
   * flag distinguishes it from a borrowed reference. Requires `handle` to fit
   * {@link kStringRefIndexMask}.
   */
  static constexpr Value managedString(uint32_t handle) {
    return Value(ValueTag::String, Payload(handle | kManagedStringRefBit));
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

  /** A `Struct` value: its type-table index plus the managed-heap handle. */
  static constexpr Value structValue(uint32_t typeId, uint32_t handle) {
    return Value(ValueTag::Struct, Payload(Compound{typeId, handle}));
  }

  /** A `Function` value, optionally carrying a captures handle. */
  static constexpr Value function(uint32_t funcId, uint32_t captures = kNoCaptures) {
    return Value(ValueTag::Function, Payload(Function{funcId, captures}));
  }

  /**
   * A `Buffer` value borrowing `byteCount` raw bytes at `byteOffset` in the
   * program image's borrowed bytes ({@link ProgramImage::stringData}). The
   * bytes are immutable.
   */
  static constexpr Value borrowedBuffer(uint32_t byteOffset, uint32_t byteCount) {
    return Value(ValueTag::Buffer, Payload(BufferRef{byteOffset, byteCount}));
  }

  /**
   * A `Buffer` value referencing managed-heap buffer object `handle` (a host-
   * constructed, collectable buffer) of `byteCount` immutable bytes. The {@link
   * kManagedBufferRefBit} flag distinguishes it from a borrowed reference;
   * `byteCount` mirrors the object's length so {@link bufferLength} answers
   * without resolving the object. Requires `handle` to fit {@link
   * kBufferRefIndexMask}.
   */
  static constexpr Value managedBuffer(uint32_t handle, uint32_t byteCount) {
    return Value(ValueTag::Buffer, Payload(BufferRef{handle | kManagedBufferRefBit, byteCount}));
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

  /** True when the tag is `Struct`. */
  constexpr bool isStruct() const { return tag_ == ValueTag::Struct; }

  /** True when the tag is `Function`. */
  constexpr bool isFunction() const { return tag_ == ValueTag::Function; }

  /** True when the tag is `Buffer`. */
  constexpr bool isBuffer() const { return tag_ == ValueTag::Buffer; }

  /**
   * True when the tag is `Buffer` and the reference is a managed (collectable)
   * heap handle; false for a borrowed constant-pool reference.
   */
  constexpr bool isManagedBuffer() const {
    return tag_ == ValueTag::Buffer && (payload_.buffer.byteOffset & kManagedBufferRefBit) != 0;
  }

  /** True when the tag is `Err` (a VM-internal error value). */
  constexpr bool isErr() const { return tag_ == ValueTag::Err; }

  /** True when the tag is `Handle` (a VM-internal async handle value). */
  constexpr bool isHandle() const { return tag_ == ValueTag::Handle; }

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
   * True when the tag is `String` and the reference is a managed (collectable)
   * heap handle; false for a borrowed constant-pool reference.
   */
  constexpr bool isManagedString() const {
    return tag_ == ValueTag::String && (payload_.ref & kManagedStringRefBit) != 0;
  }

  /**
   * The string-table index of a borrowed string reference. Requires tag
   * `String` and a borrowed (bit-clear) reference.
   */
  constexpr uint32_t borrowedStringIndex() const { return payload_.ref & kStringRefIndexMask; }

  /**
   * The managed-heap handle of a managed string reference. Requires tag
   * `String` and a managed (bit-set) reference.
   */
  constexpr uint32_t managedStringHandle() const { return payload_.ref & kStringRefIndexMask; }

  /** The type-table index. Requires tag `Enum`, `List`, `Map`, or `Struct`. */
  constexpr uint32_t typeId() const { return payload_.compound.typeId; }

  /**
   * The managed-heap handle of a container value. Requires tag `List` or
   * `Map`.
   */
  constexpr uint32_t containerHandle() const { return payload_.compound.ref; }

  /** The managed-heap handle of a struct value. Requires tag `Struct`. */
  constexpr uint32_t structHandle() const { return payload_.compound.ref; }

  /** The declared-symbol ordinal. Requires tag `Enum`. */
  constexpr uint32_t enumOrdinal() const { return payload_.compound.ref; }

  /** The referenced funcId. Requires tag `Function`. */
  constexpr uint32_t functionId() const { return payload_.fn.funcId; }

  /**
   * The captures handle, or {@link kNoCaptures} when absent. Requires tag
   * `Function`.
   */
  constexpr uint32_t functionCaptures() const { return payload_.fn.captures; }

  /** Byte offset of a borrowed buffer's first byte in the program image's borrowed bytes. Requires
   * a borrowed `Buffer`. */
  constexpr uint32_t bufferOffset() const {
    return payload_.buffer.byteOffset & kBufferRefIndexMask;
  }

  /** The managed-heap handle of a managed buffer reference. Requires a managed `Buffer`. */
  constexpr uint32_t managedBufferHandle() const {
    return payload_.buffer.byteOffset & kBufferRefIndexMask;
  }

  /** Number of bytes in the buffer. Requires tag `Buffer`. */
  constexpr uint32_t bufferLength() const { return payload_.buffer.byteCount; }

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
    constexpr explicit Payload(BufferRef value) : buffer(value) {}

    mc_number_t num;
    bool boolean;
    uint32_t ref;
    uint16_t errCode;
    Compound compound;
    Function fn;
    BufferRef buffer;
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
