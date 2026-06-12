#include "doctest/doctest.h"

#include "core/runtime/load-error.h"

#include <cstdint>
#include <iterator>

using mindcraft::kLoadErrorNames;
using mindcraft::LoadError;
using mindcraft::loadErrorName;

TEST_CASE("LoadError values are stable") {
  CHECK(static_cast<uint16_t>(LoadError::Truncated) == 1);
  CHECK(static_cast<uint16_t>(LoadError::VarIntOverflow) == 2);
}

TEST_CASE("name table covers every declared code in declaration order") {
  REQUIRE(std::size(kLoadErrorNames) == 2);
  CHECK(kLoadErrorNames[0].code == LoadError::Truncated);
  CHECK(kLoadErrorNames[1].code == LoadError::VarIntOverflow);
}

TEST_CASE("loadErrorName returns canonical names") {
  CHECK(loadErrorName(LoadError::Truncated) == doctest::String("Truncated"));
  CHECK(loadErrorName(LoadError::VarIntOverflow) == doctest::String("VarIntOverflow"));
}

TEST_CASE("loadErrorName returns nullptr for undeclared values") {
  CHECK(loadErrorName(static_cast<LoadError>(0)) == nullptr);
  CHECK(loadErrorName(static_cast<LoadError>(3)) == nullptr);
}
