#include "doctest/doctest.h"

#include "core/runtime/numeric.h"

#include <cmath>
#include <limits>

using wendoo::toNonNegativeInteger;

TEST_CASE("toNonNegativeInteger truncates a positive value toward zero") {
  CHECK(toNonNegativeInteger(2.9f) == 2u);
  CHECK(toNonNegativeInteger(5.0f) == 5u);
  CHECK(toNonNegativeInteger(0.9f) == 0u);
  CHECK(toNonNegativeInteger(250.0f) == 250u);
}

TEST_CASE("toNonNegativeInteger clamps zero and negatives to zero") {
  CHECK(toNonNegativeInteger(0.0f) == 0u);
  CHECK(toNonNegativeInteger(-1.0f) == 0u);
  CHECK(toNonNegativeInteger(-2.9f) == 0u);
}

TEST_CASE("toNonNegativeInteger maps non-finite values to zero") {
  CHECK(toNonNegativeInteger(std::numeric_limits<float>::quiet_NaN()) == 0u);
  CHECK(toNonNegativeInteger(std::numeric_limits<float>::infinity()) == 0u);
  CHECK(toNonNegativeInteger(-std::numeric_limits<float>::infinity()) == 0u);
}
