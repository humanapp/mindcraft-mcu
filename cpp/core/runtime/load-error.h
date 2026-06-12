#pragma once

#include <cstdint>

namespace mindcraft {

/**
 * Diagnostic codes for failures while decoding a device-bound binary payload.
 * The numeric values are local to this VM (they never travel on a wire);
 * append new members at the next free value when a new decode failure mode
 * is added.
 */
enum class LoadError : uint16_t {
  /** A read would pass the end of the input buffer. */
  Truncated = 1,
  /** A var-int encodes a value that does not fit in 32 bits. */
  VarIntOverflow = 2,
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
};

/**
 * Return the canonical ASCII name for `code` (e.g. `LoadError::Truncated ->
 * "Truncated"`), or nullptr when the value is not a declared member. For use
 * at the diagnostics boundary when rendering decode failures for humans; the
 * runtime never compares against the name.
 */
const char* loadErrorName(LoadError code);

} // namespace mindcraft
