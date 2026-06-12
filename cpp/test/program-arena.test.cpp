#include "doctest/doctest.h"

#include "core/runtime/program-arena.h"

#include <array>
#include <cstdint>

using mindcraft::ProgramArena;
using mindcraft::Span;

TEST_CASE("allocations are naturally aligned and zero-filled") {
  alignas(8) std::array<uint8_t, 256> storage;
  storage.fill(0xab);
  ProgramArena arena(Span<uint8_t>(storage.data(), storage.size()));

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
  ProgramArena arena(Span<uint8_t>(storage.data(), storage.size()));

  CHECK(arena.allocate<uint32_t>(5) == nullptr);
  CHECK(arena.bytesUsed() == 0);

  uint32_t* words = arena.allocate<uint32_t>(4);
  REQUIRE(words != nullptr);
  CHECK(arena.bytesUsed() == 16);
  CHECK(arena.allocate<uint8_t>(1) == nullptr);
}

TEST_CASE("a zero-count allocation succeeds without consuming storage") {
  alignas(8) std::array<uint8_t, 8> storage{};
  ProgramArena arena(Span<uint8_t>(storage.data(), storage.size()));

  CHECK(arena.allocate<uint32_t>(0) != nullptr);
  CHECK(arena.bytesUsed() == 0);
}

TEST_CASE("oversized element counts fail instead of wrapping") {
  alignas(8) std::array<uint8_t, 64> storage{};
  ProgramArena arena(Span<uint8_t>(storage.data(), storage.size()));

  const size_t huge = static_cast<size_t>(-1) / sizeof(uint32_t) + 1;
  CHECK(arena.allocate<uint32_t>(huge) == nullptr);
}
