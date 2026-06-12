#pragma once

#include <cstdint>

namespace mindcraft {

/**
 * Numeric fault classifier carried by every VM error value. Mirrors the
 * `ErrorCode` enum in
 * external/mindcraft-lang/packages/core/src/runtime/value.ts. Values are
 * wire-stable across the TS reference VM and this port; never renumber or
 * reuse a value.
 */
enum class ErrorCode : uint16_t {
  Timeout = 1,
  Cancelled = 2,
  HostError = 3,
  ScriptError = 4,
  StackOverflow = 5,
  StackUnderflow = 6,
};

/** One row of the {@link kErrorCodeNames} table: a code and its canonical ASCII name. */
struct ErrorCodeName {
  ErrorCode code;
  const char* name;
};

/** Canonical name table, one row per declared ErrorCode member, in declaration order. */
inline constexpr ErrorCodeName kErrorCodeNames[] = {
    {ErrorCode::Timeout, "Timeout"},
    {ErrorCode::Cancelled, "Cancelled"},
    {ErrorCode::HostError, "HostError"},
    {ErrorCode::ScriptError, "ScriptError"},
    {ErrorCode::StackOverflow, "StackOverflow"},
    {ErrorCode::StackUnderflow, "StackUnderflow"},
};

/**
 * Return the canonical ASCII name for `code` (e.g. `ErrorCode::ScriptError ->
 * "ScriptError"`), or nullptr when the value is not a declared member. For use
 * at the diagnostics boundary when rendering errors for humans; the runtime
 * never compares against the name.
 */
const char* errorCodeName(ErrorCode code);

} // namespace mindcraft
