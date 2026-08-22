#pragma once

#include <type_traits>

#include "core/runtime/error-code.h"

namespace wendoo {

/**
 * Success/failure outcome of an operation that yields no value. Construct via
 * {@link Status::ok} or {@link Status::fail}; query with {@link Status::isOk}
 * and read the fault code with {@link Status::error}.
 */
class [[nodiscard]] Status {
public:
  /** A successful outcome. */
  static constexpr Status ok() { return Status(true, ErrorCode::HostError); }

  /** A failed outcome carrying `code`. */
  static constexpr Status fail(ErrorCode code) { return Status(false, code); }

  /** True when the operation succeeded. */
  constexpr bool isOk() const { return ok_; }

  /** The fault code. Meaningful only when {@link isOk} is false. */
  constexpr ErrorCode error() const { return code_; }

private:
  constexpr Status(bool ok, ErrorCode code) : ok_(ok), code_(code) {}

  bool ok_;
  ErrorCode code_;
};

/**
 * Outcome carrying a value of type T on success or an error enum value of
 * type E (default {@link ErrorCode}) on failure. T must be trivially copyable
 * and default constructible. Construct via {@link Result::ok} or
 * {@link Result::fail}; {@link Result::value} is valid only when
 * {@link Result::isOk} is true.
 */
template <typename T, typename E = ErrorCode> class [[nodiscard]] Result {
  static_assert(std::is_trivially_copyable_v<T>, "Result payloads must be trivially copyable");
  static_assert(std::is_default_constructible_v<T>,
                "Result payloads must be default constructible");
  static_assert(std::is_enum_v<E>, "Result error types must be enums");

public:
  /** A successful outcome carrying `value`. */
  static constexpr Result ok(const T& value) {
    Result result;
    result.ok_ = true;
    result.value_ = value;
    return result;
  }

  /** A failed outcome carrying `code`. */
  static constexpr Result fail(E code) {
    Result result;
    result.code_ = code;
    return result;
  }

  /** True when the operation succeeded and {@link value} is readable. */
  constexpr bool isOk() const { return ok_; }

  /** The fault code. Meaningful only when {@link isOk} is false. */
  constexpr E error() const { return code_; }

  /** The carried value. Valid only when {@link isOk} is true. */
  constexpr const T& value() const { return value_; }

private:
  constexpr Result() = default;

  bool ok_ = false;
  E code_{};
  T value_{};
};

} // namespace wendoo
