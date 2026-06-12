#include "doctest/doctest.h"

#include "core/platform/span.h"
#include "core/runtime/stack-pool.h"
#include "core/runtime/value.h"

#include <array>

using mindcraft::kNilValue;
using mindcraft::Span;
using mindcraft::StackRegionPool;
using mindcraft::Value;

TEST_CASE("regions stack upward and release in LIFO order") {
  std::array<Value, 8> storage;
  StackRegionPool<Value> pool(Span<Value>(storage.data(), storage.size()));
  CHECK(pool.highWater() == 0);

  Value* first = pool.acquire(3);
  REQUIRE(first == storage.data());
  CHECK(pool.highWater() == 3);

  Value* second = pool.acquire(2);
  REQUIRE(second == storage.data() + 3);
  CHECK(pool.highWater() == 5);

  pool.releaseTo(second);
  CHECK(pool.highWater() == 3);

  Value* reused = pool.acquire(5);
  REQUIRE(reused == storage.data() + 3);
  CHECK(pool.highWater() == 8);

  pool.releaseTo(reused);
  pool.releaseTo(first);
  CHECK(pool.highWater() == 0);
}

TEST_CASE("a suspended region's contents survive later acquire/release churn") {
  std::array<Value, 8> storage;
  StackRegionPool<Value> pool(Span<Value>(storage.data(), storage.size()));

  Value* suspended = pool.acquire(2);
  suspended[0] = Value::number(1.5f);
  suspended[1] = Value::number(-2.0f);

  Value* transient = pool.acquire(4);
  for (int i = 0; i < 4; i++) {
    transient[i] = Value::number(99.0f);
  }
  pool.releaseTo(transient);

  CHECK(suspended[0].asNumber() == 1.5f);
  CHECK(suspended[1].asNumber() == -2.0f);
}

TEST_CASE("acquire fails once the storage is exhausted") {
  std::array<Value, 4> storage;
  StackRegionPool<Value> pool(Span<Value>(storage.data(), storage.size()));

  REQUIRE(pool.acquire(4) != nullptr);
  CHECK(pool.acquire(1) == nullptr);

  // A zero-slot region is valid and does not move the high-water mark.
  CHECK(pool.acquire(0) != nullptr);
  CHECK(pool.highWater() == 4);
}
