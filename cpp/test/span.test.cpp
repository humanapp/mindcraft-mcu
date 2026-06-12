#include "doctest/doctest.h"

#include "core/platform/span.h"

using mindcraft::ByteSpan;
using mindcraft::Span;

TEST_CASE("default span is empty") {
  ByteSpan span;
  CHECK(span.empty());
  CHECK(span.size() == 0);
  CHECK(span.data() == nullptr);
}

TEST_CASE("span views existing storage without copying") {
  uint8_t bytes[] = {0x4d, 0x43, 0x50, 0x47};
  ByteSpan span(bytes, sizeof(bytes));
  REQUIRE(span.size() == 4);
  CHECK_FALSE(span.empty());
  CHECK(span[0] == 0x4d);
  CHECK(span[3] == 0x47);
  CHECK(span.data() == bytes);
}

TEST_CASE("span supports range iteration") {
  int values[] = {1, 2, 3};
  Span<int> span(values, 3);
  int sum = 0;
  for (int v : span) {
    sum += v;
  }
  CHECK(sum == 6);
}

TEST_CASE("mutable span writes through to the viewed storage") {
  int values[] = {1, 2, 3};
  Span<int> span(values, 3);
  span[1] = 20;
  CHECK(values[1] == 20);
}
