#include "doctest/doctest.h"

#include "core/runtime/context-field.h"

#include <cstdint>

using wendoo::ContextField;
using wendoo::kContextFieldCount;

TEST_CASE("ContextField values are wire-stable") {
  CHECK(static_cast<uint8_t>(ContextField::Time) == 0);
  CHECK(static_cast<uint8_t>(ContextField::Dt) == 1);
  CHECK(static_cast<uint8_t>(ContextField::Tick) == 2);
  CHECK(static_cast<uint8_t>(ContextField::Brain) == 3);
  CHECK(static_cast<uint8_t>(ContextField::Engine) == 4);
  CHECK(static_cast<uint8_t>(ContextField::Rule) == 5);
  CHECK(kContextFieldCount == 6);
}
