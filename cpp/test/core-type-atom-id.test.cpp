#include "doctest/doctest.h"

#include "core/runtime/core-type-atom-id.h"

#include <cstdint>

using mindcraft::CoreTypeAtomId;
using mindcraft::kCoreTypeAtomIdCount;
using mindcraft::TARGET_TYPE_ATOM_BASE;

TEST_CASE("type-atom partition constant matches the TS declaration") {
  CHECK(TARGET_TYPE_ATOM_BASE == 1024);
}

TEST_CASE("CoreTypeAtomId values are wire-stable") {
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Void) == 0);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Nil) == 1);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Boolean) == 2);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Number) == 3);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::String) == 4);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Any) == 5);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Function) == 6);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::AnyList) == 7);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::BrainContext) == 8);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::EngineContext) == 9);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::RuleContext) == 10);
  CHECK(static_cast<uint32_t>(CoreTypeAtomId::Context) == 11);
  CHECK(kCoreTypeAtomIdCount == 12);
  CHECK(kCoreTypeAtomIdCount <= TARGET_TYPE_ATOM_BASE);
}
