#include "doctest/doctest.h"

#include "core/runtime/error-code.h"

#include <cstdint>

using mindcraft::ErrorCode;
using mindcraft::errorCodeName;
using mindcraft::kErrorCodeNames;

TEST_CASE("ErrorCode values are wire-stable") {
  CHECK(static_cast<uint16_t>(ErrorCode::Timeout) == 1);
  CHECK(static_cast<uint16_t>(ErrorCode::Cancelled) == 2);
  CHECK(static_cast<uint16_t>(ErrorCode::HostError) == 3);
  CHECK(static_cast<uint16_t>(ErrorCode::ScriptError) == 4);
  CHECK(static_cast<uint16_t>(ErrorCode::StackOverflow) == 5);
  CHECK(static_cast<uint16_t>(ErrorCode::StackUnderflow) == 6);
}

TEST_CASE("name table covers every declared code in declaration order") {
  REQUIRE(std::size(kErrorCodeNames) == 6);
  CHECK(kErrorCodeNames[0].code == ErrorCode::Timeout);
  CHECK(kErrorCodeNames[5].code == ErrorCode::StackUnderflow);
}

TEST_CASE("errorCodeName returns canonical names") {
  CHECK(errorCodeName(ErrorCode::Timeout) == doctest::String("Timeout"));
  CHECK(errorCodeName(ErrorCode::Cancelled) == doctest::String("Cancelled"));
  CHECK(errorCodeName(ErrorCode::HostError) == doctest::String("HostError"));
  CHECK(errorCodeName(ErrorCode::ScriptError) == doctest::String("ScriptError"));
  CHECK(errorCodeName(ErrorCode::StackOverflow) == doctest::String("StackOverflow"));
  CHECK(errorCodeName(ErrorCode::StackUnderflow) == doctest::String("StackUnderflow"));
}

TEST_CASE("errorCodeName returns nullptr for undeclared values") {
  CHECK(errorCodeName(static_cast<ErrorCode>(0)) == nullptr);
  CHECK(errorCodeName(static_cast<ErrorCode>(7)) == nullptr);
  CHECK(errorCodeName(static_cast<ErrorCode>(65535)) == nullptr);
}
