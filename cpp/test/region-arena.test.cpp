#include "doctest/doctest.h"

#include "core/platform/span.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"

#include <array>
#include <cstdint>

using mindcraft::RegionArena;
using mindcraft::Span;
using mindcraft::Value;

TEST_CASE("allocations are naturally aligned and zero-filled") {
  alignas(8) std::array<uint8_t, 256> storage;
  storage.fill(0xab);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  uint8_t* bytes = arena.allocate<uint8_t>(3);
  REQUIRE(bytes != nullptr);
  CHECK(bytes[0] == 0);
  CHECK(bytes[2] == 0);

  uint32_t* words = arena.allocate<uint32_t>(2);
  REQUIRE(words != nullptr);
  CHECK(reinterpret_cast<uintptr_t>(words) % alignof(uint32_t) == 0);
  CHECK(words[0] == 0);
  CHECK(words[1] == 0);

  double* doubles = arena.allocate<double>(1);
  REQUIRE(doubles != nullptr);
  CHECK(reinterpret_cast<uintptr_t>(doubles) % alignof(double) == 0);

  CHECK(arena.bytesUsed() >= 3 + 2 * sizeof(uint32_t) + sizeof(double));
  CHECK(arena.bytesUsed() + arena.bytesRemaining() == storage.size());
}

TEST_CASE("exhaustion returns nullptr and leaves the arena usable") {
  alignas(8) std::array<uint8_t, 16> storage{};
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  CHECK(arena.allocate<uint32_t>(5) == nullptr);
  CHECK(arena.bytesUsed() == 0);

  uint32_t* words = arena.allocate<uint32_t>(4);
  REQUIRE(words != nullptr);
  CHECK(arena.bytesUsed() == 16);
  CHECK(arena.allocate<uint8_t>(1) == nullptr);
}

TEST_CASE("a zero-count allocation succeeds without consuming storage") {
  alignas(8) std::array<uint8_t, 8> storage{};
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  CHECK(arena.allocate<uint32_t>(0) != nullptr);
  CHECK(arena.bytesUsed() == 0);
}

TEST_CASE("oversized element counts fail instead of wrapping") {
  alignas(8) std::array<uint8_t, 64> storage{};
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  const size_t huge = static_cast<size_t>(-1) / sizeof(uint32_t) + 1;
  CHECK(arena.allocate<uint32_t>(huge) == nullptr);
}

TEST_CASE("carve bumps without zero-filling, unlike allocate") {
  alignas(8) std::array<uint8_t, 64> storage;
  storage.fill(0xab);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  uint8_t* raw = arena.carve<uint8_t>(4);
  REQUIRE(raw != nullptr);
  // carve leaves the bytes as found; the execution state initializes them.
  CHECK(raw[0] == 0xab);
  CHECK(raw[3] == 0xab);
}

TEST_CASE("carved regions stack upward and release to a mark in LIFO order") {
  std::array<uint8_t, 8 * sizeof(Value)> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  CHECK(arena.bytesUsed() == 0);

  Value* first = arena.carve<Value>(3);
  REQUIRE(first != nullptr);
  CHECK(arena.bytesUsed() == 3 * sizeof(Value));

  const RegionArena::Mark afterFirst = arena.mark();
  Value* second = arena.carve<Value>(2);
  REQUIRE(second == first + 3);
  CHECK(arena.bytesUsed() == 5 * sizeof(Value));

  arena.releaseTo(afterFirst);
  CHECK(arena.bytesUsed() == 3 * sizeof(Value));

  Value* reused = arena.carve<Value>(5);
  REQUIRE(reused == first + 3);
  CHECK(arena.bytesUsed() == 8 * sizeof(Value));
}

TEST_CASE("a region below a released mark keeps its contents through churn") {
  std::array<uint8_t, 8 * sizeof(Value)> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  Value* suspended = arena.carve<Value>(2);
  suspended[0] = Value::number(1.5f);
  suspended[1] = Value::number(-2.0f);

  const RegionArena::Mark mark = arena.mark();
  Value* transient = arena.carve<Value>(4);
  for (int i = 0; i < 4; i++) {
    transient[i] = Value::number(99.0f);
  }
  arena.releaseTo(mark);

  CHECK(suspended[0].asNumber() == 1.5f);
  CHECK(suspended[1].asNumber() == -2.0f);
}

TEST_CASE("carve fails once the arena is exhausted") {
  std::array<uint8_t, 4 * sizeof(Value)> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  REQUIRE(arena.carve<Value>(4) != nullptr);
  CHECK(arena.carve<Value>(1) == nullptr);

  // A zero-slot carve is valid and does not move the high-water mark.
  CHECK(arena.carve<Value>(0) != nullptr);
  CHECK(arena.bytesUsed() == 4 * sizeof(Value));
}
