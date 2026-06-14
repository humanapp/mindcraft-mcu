#include "doctest/doctest.h"

#include "core/runtime/managed-heap.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"

#include <cstdint>
#include <limits>
#include <vector>

using mindcraft::GcMarker;
using mindcraft::GcRoots;
using mindcraft::isTruthy;
using mindcraft::ListObject;
using mindcraft::ManagedHeap;
using mindcraft::MapKey;
using mindcraft::MapObject;
using mindcraft::ProgramImage;
using mindcraft::RegionArena;
using mindcraft::Span;
using mindcraft::Value;

namespace {

/** A mutable root set standing in for the VM's live operand-stack slots. */
struct RootSet : GcRoots {
  std::vector<Value> roots;

  void enumerateRoots(GcMarker& marker) override {
    for (const Value& value : roots) {
      marker.mark(value);
    }
  }
};

/** A number-keyed map key. */
MapKey numKey(float n) { return MapKey{true, n, 0}; }

/** A borrowed-string map key referencing constant-pool string index `idx`. */
MapKey strKey(uint32_t idx) { return MapKey{false, 0.0f, idx}; }

} // namespace

TEST_CASE("a fresh list is empty and lengths track pushes") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value listValue;
  REQUIRE(heap.newList(7, &roots, listValue));
  REQUIRE(listValue.isList());
  CHECK(listValue.typeId() == 7u);
  ListObject* list = heap.list(listValue);
  CHECK(list->size == 0u);

  for (int i = 0; i < 5; i++) {
    REQUIRE(heap.listPush(list, Value::number(static_cast<float>(i)), &roots));
  }
  CHECK(list->size == 5u);
  CHECK(heap.listGet(list, 0).asNumber() == 0.0f);
  CHECK(heap.listGet(list, 4).asNumber() == 4.0f);
}

TEST_CASE("list reads past the ends yield nil and empty pop/shift yield nil") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value listValue;
  REQUIRE(heap.newList(0, &roots, listValue));
  ListObject* list = heap.list(listValue);

  CHECK(heap.listGet(list, 0).isNil());
  CHECK(heap.listPop(list).isNil());
  CHECK(heap.listShift(list).isNil());

  REQUIRE(heap.listPush(list, Value::number(10.0f), &roots));
  CHECK(heap.listGet(list, -1).isNil());
  CHECK(heap.listGet(list, 1).isNil());
  CHECK(heap.listGet(list, 0).asNumber() == 10.0f);
}

TEST_CASE("list set, insert, remove, shift, and swap match the array semantics") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value listValue;
  REQUIRE(heap.newList(0, &roots, listValue));
  ListObject* list = heap.list(listValue);
  for (int i = 0; i < 4; i++) {
    REQUIRE(heap.listPush(list, Value::number(static_cast<float>(i)), &roots)); // [0,1,2,3]
  }

  heap.listSet(list, 1, Value::number(9.0f)); // [0,9,2,3]
  CHECK(heap.listGet(list, 1).asNumber() == 9.0f);

  REQUIRE(heap.listInsert(list, 2, Value::number(8.0f), &roots)); // [0,9,8,2,3]
  CHECK(list->size == 5u);
  CHECK(heap.listGet(list, 2).asNumber() == 8.0f);
  CHECK(heap.listGet(list, 3).asNumber() == 2.0f);

  CHECK(heap.listRemove(list, 0).asNumber() == 0.0f); // [9,8,2,3]
  CHECK(list->size == 4u);
  CHECK(heap.listGet(list, 0).asNumber() == 9.0f);

  CHECK(heap.listShift(list).asNumber() == 9.0f); // [8,2,3]
  CHECK(list->size == 3u);

  heap.listSwap(list, 0, 2); // [3,2,8]
  CHECK(heap.listGet(list, 0).asNumber() == 3.0f);
  CHECK(heap.listGet(list, 2).asNumber() == 8.0f);

  CHECK(heap.listRemove(list, 9).isNil()); // out-of-range remove is a no-op
  CHECK(list->size == 3u);
}

TEST_CASE("a list backing is shared through every reference") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value listValue;
  REQUIRE(heap.newList(0, &roots, listValue));
  const Value alias = listValue; // a copy of the value, same handle

  REQUIRE(heap.listPush(heap.list(listValue), Value::number(1.0f), &roots));
  REQUIRE(heap.listPush(heap.list(alias), Value::number(2.0f), &roots));

  CHECK(heap.list(listValue)->size == 2u);
  CHECK(heap.list(alias)->size == 2u);
  CHECK(heap.listGet(heap.list(alias), 0).asNumber() == 1.0f);
  CHECK(heap.listGet(heap.list(listValue), 1).asNumber() == 2.0f);
}

TEST_CASE("map preserves insertion order semantics with SameValueZero number keys") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;
  Value mapValue;
  REQUIRE(heap.newMap(8, &roots, mapValue));
  MapObject* map = heap.map(mapValue);

  REQUIRE(heap.mapSet(map, numKey(1.0f), Value::number(10.0f), &roots));
  REQUIRE(heap.mapSet(map, numKey(2.0f), Value::number(20.0f), &roots));
  CHECK(map->size == 2u);

  // Updating an existing key keeps its slot, not appends.
  REQUIRE(heap.mapSet(map, numKey(1.0f), Value::number(11.0f), &roots));
  CHECK(map->size == 2u);
  CHECK(heap.mapGet(map, numKey(1.0f)).asNumber() == 11.0f);

  // +0 and -0 are one key; NaN is a usable key equal only to itself.
  REQUIRE(heap.mapSet(map, numKey(0.0f), Value::number(1.0f), &roots));
  REQUIRE(heap.mapSet(map, numKey(-0.0f), Value::number(2.0f), &roots));
  CHECK(heap.mapGet(map, numKey(0.0f)).asNumber() == 2.0f);
  const float nan = std::numeric_limits<float>::quiet_NaN();
  REQUIRE(heap.mapSet(map, numKey(nan), Value::number(42.0f), &roots));
  CHECK(heap.mapHas(map, numKey(nan)));
  CHECK(heap.mapGet(map, numKey(nan)).asNumber() == 42.0f);

  CHECK(heap.mapHas(map, numKey(2.0f)));
  heap.mapDelete(map, numKey(2.0f));
  CHECK_FALSE(heap.mapHas(map, numKey(2.0f)));
  CHECK(heap.mapGet(map, numKey(2.0f)).isNil());
}

TEST_CASE("map string keys are identified by their constant-pool index") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value mapValue;
  REQUIRE(heap.newMap(0, &roots, mapValue));
  MapObject* map = heap.map(mapValue);

  REQUIRE(heap.mapSet(map, strKey(0), Value::number(1.0f), &roots));
  CHECK(heap.mapHas(map, strKey(0)));
  CHECK(heap.mapGet(map, strKey(0)).asNumber() == 1.0f);

  // The same index is the same key: an update keeps the single entry.
  REQUIRE(heap.mapSet(map, strKey(0), Value::number(2.0f), &roots));
  CHECK(map->size == 1u);
  CHECK(heap.mapGet(map, strKey(0)).asNumber() == 2.0f);

  // A different index is a distinct key, and a number key never matches a string key.
  CHECK_FALSE(heap.mapHas(map, strKey(1)));
  CHECK_FALSE(heap.mapHas(map, numKey(0.0f)));
}

TEST_CASE("container truthiness follows non-emptiness") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;
  const ProgramImage program{};

  Value listValue;
  REQUIRE(heap.newList(0, &roots, listValue));
  CHECK_FALSE(isTruthy(listValue, program, &heap)); // empty list is falsy
  REQUIRE(heap.listPush(heap.list(listValue), Value::number(1.0f), &roots));
  CHECK(isTruthy(listValue, program, &heap)); // non-empty list is truthy

  Value mapValue;
  REQUIRE(heap.newMap(0, &roots, mapValue));
  CHECK_FALSE(isTruthy(mapValue, program, &heap)); // empty map is falsy
  REQUIRE(heap.mapSet(heap.map(mapValue), numKey(1.0f), Value::number(2.0f), &roots));
  CHECK(isTruthy(mapValue, program, &heap)); // non-empty map is truthy
}

TEST_CASE("allocation pressure collects unreachable containers and retries") {
  // A region large enough for only a handful of list objects forces the
  // collect-on-fail path on every allocation past the first few.
  std::vector<uint8_t> storage(2 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;
  roots.roots.push_back(Value::nil()); // slot 0 holds the one active list

  for (int i = 0; i < 500; i++) {
    Value current;
    REQUIRE(heap.newList(0, &roots, current));
    // Root the active list before mutating it, exactly as the VM keeps it on
    // the operand stack; the previous list is now unreachable and reclaimable.
    roots.roots[0] = current;
    REQUIRE(heap.listPush(heap.list(current), Value::number(static_cast<float>(i)), &roots));
  }
  // Only the last list stays rooted; clearing the root makes it collectable.
  CHECK(heap.liveListCount() >= 1u);
  roots.roots.clear();
  heap.collect(roots);
  CHECK(heap.liveListCount() == 0u);
}

TEST_CASE("exhaustion with all roots live faults deterministically") {
  std::vector<uint8_t> storage(2 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  // Keep every list reachable so collection can never reclaim one.
  bool exhausted = false;
  for (int i = 0; i < 100000 && !exhausted; i++) {
    Value listValue;
    if (!heap.newList(0, &roots, listValue)) {
      exhausted = true;
      break;
    }
    roots.roots.push_back(listValue);
  }
  CHECK(exhausted);
  CHECK(heap.liveListCount() == roots.roots.size());
}

TEST_CASE("the collector reclaims unreachable cycles") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value a;
  REQUIRE(heap.newList(0, &roots, a));
  roots.roots.push_back(a);
  Value b;
  REQUIRE(heap.newList(0, &roots, b));
  roots.roots.push_back(b);
  // a -> b -> a, a self-referential cycle, built while both ends are rooted.
  REQUIRE(heap.listPush(heap.list(a), b, &roots));
  REQUIRE(heap.listPush(heap.list(b), a, &roots));

  // Rooting only a keeps the whole cycle reachable.
  roots.roots.clear();
  roots.roots.push_back(a);
  heap.collect(roots);
  CHECK(heap.liveListCount() == 2u);

  // Dropping the root makes the cycle unreachable; tracing reclaims both.
  roots.roots.clear();
  heap.collect(roots);
  CHECK(heap.liveListCount() == 0u);
}

TEST_CASE("nested containers stay reachable through a rooted parent") {
  std::vector<uint8_t> storage(8 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  RootSet roots;

  Value outer;
  REQUIRE(heap.newList(0, &roots, outer));
  roots.roots.push_back(outer);
  Value inner;
  REQUIRE(heap.newList(0, &roots, inner));
  roots.roots.push_back(inner);
  Value innerMap;
  REQUIRE(heap.newMap(0, &roots, innerMap));
  roots.roots.push_back(innerMap);
  REQUIRE(heap.listPush(heap.list(inner), Value::number(7.0f), &roots));
  REQUIRE(heap.mapSet(heap.map(innerMap), numKey(1.0f), Value::number(5.0f), &roots));
  REQUIRE(heap.listPush(heap.list(outer), inner, &roots));
  REQUIRE(heap.listPush(heap.list(outer), innerMap, &roots));

  // Keep only the outer container rooted; the nested ones survive through it.
  roots.roots.clear();
  roots.roots.push_back(outer);
  heap.collect(roots);
  CHECK(heap.liveListCount() == 2u);
  CHECK(heap.liveMapCount() == 1u);
  // The nested values survive and stay intact.
  CHECK(heap.listGet(heap.list(inner), 0).asNumber() == 7.0f);
  CHECK(heap.mapGet(heap.map(innerMap), numKey(1.0f)).asNumber() == 5.0f);
}
