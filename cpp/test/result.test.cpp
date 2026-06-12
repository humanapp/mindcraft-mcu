#include "doctest/doctest.h"

#include "core/runtime/result.h"

using mindcraft::ErrorCode;
using mindcraft::Result;
using mindcraft::Status;

TEST_CASE("Status reports success") {
  Status status = Status::ok();
  CHECK(status.isOk());
}

TEST_CASE("Status carries a fault code") {
  Status status = Status::fail(ErrorCode::ScriptError);
  CHECK_FALSE(status.isOk());
  CHECK(status.error() == ErrorCode::ScriptError);
}

TEST_CASE("Result carries a value on success") {
  Result<int32_t> result = Result<int32_t>::ok(42);
  REQUIRE(result.isOk());
  CHECK(result.value() == 42);
}

TEST_CASE("Result carries a fault code on failure") {
  Result<int32_t> result = Result<int32_t>::fail(ErrorCode::StackOverflow);
  CHECK_FALSE(result.isOk());
  CHECK(result.error() == ErrorCode::StackOverflow);
}

TEST_CASE("Result works in constexpr context") {
  constexpr Result<uint32_t> ok = Result<uint32_t>::ok(7);
  static_assert(ok.isOk());
  static_assert(ok.value() == 7);
  constexpr Status fail = Status::fail(ErrorCode::HostError);
  static_assert(!fail.isOk());
  static_assert(fail.error() == ErrorCode::HostError);
}
