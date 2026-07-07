#pragma once

#include <cstdint>

namespace mindcraft {

/**
 * Diagnostic codes for failures while decoding a device-bound binary payload.
 * The numeric values are local to this VM (they never travel on a wire);
 * append new members at the next free value when a new decode failure mode
 * is added. The members from `InvalidMagic` through `UnknownTypeAtom` carry
 * the decode-side names of `BrainProgramBinaryCodecErrorCode` in
 * external/mindcraft-lang/packages/core/src/runtime/brain-program-binary-codec.ts;
 * keep the names aligned when that family changes.
 */
enum class LoadError : uint16_t {
  /** A read would pass the end of the input buffer. */
  Truncated = 1,
  /** A var-int encodes a value that does not fit in 32 bits. */
  VarIntOverflow = 2,
  /** The leading bytes are not the binary `.mcprogram` magic. */
  InvalidMagic = 3,
  /** The envelope format version is not the version this reader decodes. */
  UnsupportedFormatVersion = 4,
  /** An f64 numeric entry was found while decoding for an f32 target. */
  F64OnF32Target = 5,
  /** A numbers-pool discriminant byte is not one of `0`/`1`/`2`. */
  InvalidNumberDiscriminant = 6,
  /** A value tag, key tag, binding tag, or string index is not decodable. */
  InvalidValueTag = 7,
  /** An instruction opcode byte has no operand-schema entry. */
  UnknownOpcode = 8,
  /** A type-table entry tag byte is not a known type-entry tag. */
  InvalidTypeEntryTag = 9,
  /** A type-table entry references a child at or beyond its own index. */
  TypeForwardReference = 10,
  /** A type-table index is outside the decoded table. */
  TypeIndexOutOfRange = 11,
  /** An enum constant's symbol ordinal is outside its type's symbol list. */
  EnumOrdinalOutOfRange = 12,
  /** A type-table atom entry's atomId is outside the core and target id ranges. */
  UnknownTypeAtom = 13,
  /** The decode arena cannot hold the program's pools. */
  ArenaExhausted = 14,
  /**
   * The decoded program's numeric device-profile id is not the one this device
   * accepts. Raised by the host after a successful decode.
   */
  UnsupportedDeviceProfile = 15,
  /** A type-table enum entry's value-kind byte is not `0` (number) or `1` (string). */
  InvalidEnumValueKind = 16,
};

/** One row of the {@link kLoadErrorNames} table: a code and its canonical ASCII name. */
struct LoadErrorName {
  LoadError code;
  const char* name;
};

/** Canonical name table, one row per declared LoadError member, in declaration order. */
inline constexpr LoadErrorName kLoadErrorNames[] = {
    {LoadError::Truncated, "Truncated"},
    {LoadError::VarIntOverflow, "VarIntOverflow"},
    {LoadError::InvalidMagic, "InvalidMagic"},
    {LoadError::UnsupportedFormatVersion, "UnsupportedFormatVersion"},
    {LoadError::F64OnF32Target, "F64OnF32Target"},
    {LoadError::InvalidNumberDiscriminant, "InvalidNumberDiscriminant"},
    {LoadError::InvalidValueTag, "InvalidValueTag"},
    {LoadError::UnknownOpcode, "UnknownOpcode"},
    {LoadError::InvalidTypeEntryTag, "InvalidTypeEntryTag"},
    {LoadError::TypeForwardReference, "TypeForwardReference"},
    {LoadError::TypeIndexOutOfRange, "TypeIndexOutOfRange"},
    {LoadError::EnumOrdinalOutOfRange, "EnumOrdinalOutOfRange"},
    {LoadError::UnknownTypeAtom, "UnknownTypeAtom"},
    {LoadError::ArenaExhausted, "ArenaExhausted"},
    {LoadError::UnsupportedDeviceProfile, "UnsupportedDeviceProfile"},
    {LoadError::InvalidEnumValueKind, "InvalidEnumValueKind"},
};

/**
 * Return the canonical ASCII name for `code` (e.g. `LoadError::Truncated ->
 * "Truncated"`), or nullptr when the value is not a declared member. For use
 * at the diagnostics boundary when rendering decode failures for humans; the
 * runtime never compares against the name.
 */
const char* loadErrorName(LoadError code);

} // namespace mindcraft
