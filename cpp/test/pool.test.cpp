#include "doctest/doctest.h"

#include "core/platform/span.h"
#include "core/runtime/pool.h"
#include "core/runtime/region-arena.h"

#include <array>
#include <cstdint>
#include <vector>

using mindcraft::Pool;
using mindcraft::RegionArena;
using mindcraft::Span;

namespace {
struct Item {
  uint32_t value;
  uint32_t mark;
};
} // namespace

TEST_CASE("alloc hands out distinct live slots and forEachLive visits them all") {
  std::array<uint8_t, 4096> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  Pool<Item> pool(arena);

  CHECK(pool.liveCount() == 0);
  Item* a = pool.alloc();
  Item* b = pool.alloc();
  Item* c = pool.alloc();
  REQUIRE(a != nullptr);
  REQUIRE(b != nullptr);
  REQUIRE(c != nullptr);
  CHECK(a != b);
  CHECK(b != c);
  a->value = 1;
  b->value = 2;
  c->value = 3;
  CHECK(pool.liveCount() == 3);

  uint32_t sum = 0;
  uint32_t visited = 0;
  pool.forEachLive([&](Item& item) {
    sum += item.value;
    visited++;
  });
  CHECK(visited == 3);
  CHECK(sum == 6);
}

TEST_CASE("free recycles a slot for the next alloc") {
  std::array<uint8_t, 4096> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  Pool<Item> pool(arena);

  Item* first = pool.alloc();
  REQUIRE(first != nullptr);
  const size_t usedAfterFirst = arena.bytesUsed();
  pool.free(first);
  CHECK(pool.liveCount() == 0);

  Item* reused = pool.alloc();
  CHECK(reused == first);
  // Reuse drew from the free list, not the arena frontier.
  CHECK(arena.bytesUsed() == usedAfterFirst);
  CHECK(pool.liveCount() == 1);
}

TEST_CASE("forEachLive may release the slot it is handed") {
  std::array<uint8_t, 4096> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  Pool<Item> pool(arena);

  for (uint32_t i = 0; i < 5; i++) {
    pool.alloc()->mark = i % 2; // mark odd-indexed slots for release
  }
  CHECK(pool.liveCount() == 5);

  pool.forEachLive([&](Item& item) {
    if (item.mark == 1) {
      pool.free(&item);
    }
  });
  CHECK(pool.liveCount() == 3);

  uint32_t survivors = 0;
  pool.forEachLive([&](Item&) { survivors++; });
  CHECK(survivors == 3);
}

TEST_CASE("alloc returns nullptr once the arena cannot back another slot") {
  // Room for only a couple of slots.
  std::array<uint8_t, 96> storage;
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  Pool<Item> pool(arena);

  uint32_t allocated = 0;
  while (pool.alloc() != nullptr) {
    allocated++;
    REQUIRE(allocated < 1000);
  }
  CHECK(allocated >= 1);
  // A failed alloc leaves the pool usable for what already fits.
  CHECK(pool.liveCount() == allocated);
}
