#include "doctest/doctest.h"

#include "core/runtime/value.h"

#include <cstdint>

using mindcraft::ErrorCode;
using mindcraft::kFalseValue;
using mindcraft::kManagedStringRefBit;
using mindcraft::kNilValue;
using mindcraft::kNoCaptures;
using mindcraft::kStringRefIndexMask;
using mindcraft::kTrueValue;
using mindcraft::kUnknownValue;
using mindcraft::kVoidValue;
using mindcraft::Value;
using mindcraft::ValueTag;

TEST_CASE("visible-type tags carry the NativeType numbers") {
  CHECK(static_cast<int8_t>(ValueTag::Unknown) == -1);
  CHECK(static_cast<int8_t>(ValueTag::Void) == 0);
  CHECK(static_cast<int8_t>(ValueTag::Nil) == 1);
  CHECK(static_cast<int8_t>(ValueTag::Boolean) == 2);
  CHECK(static_cast<int8_t>(ValueTag::Number) == 3);
  CHECK(static_cast<int8_t>(ValueTag::String) == 4);
  CHECK(static_cast<int8_t>(ValueTag::Enum) == 5);
  CHECK(static_cast<int8_t>(ValueTag::List) == 6);
  CHECK(static_cast<int8_t>(ValueTag::Map) == 7);
  CHECK(static_cast<int8_t>(ValueTag::Struct) == 8);
  CHECK(static_cast<int8_t>(ValueTag::Function) == 11);
  CHECK(static_cast<int8_t>(ValueTag::Handle) == 100);
  CHECK(static_cast<int8_t>(ValueTag::Err) == 101);
}

TEST_CASE("singletons carry their tags and payloads") {
  CHECK(kUnknownValue.tag() == ValueTag::Unknown);
  CHECK(kVoidValue.tag() == ValueTag::Void);
  CHECK(kNilValue.tag() == ValueTag::Nil);
  CHECK(kNilValue.isNil());
  CHECK(kTrueValue.tag() == ValueTag::Boolean);
  CHECK(kTrueValue.asBoolean());
  CHECK(kFalseValue.tag() == ValueTag::Boolean);
  CHECK(!kFalseValue.asBoolean());
  CHECK(Value().tag() == ValueTag::Nil);
}

TEST_CASE("factories round-trip their payloads through the accessors") {
  const Value number = Value::number(2.5f);
  CHECK(number.isNumber());
  CHECK(number.asNumber() == 2.5f);

  const Value boolean = Value::boolean(true);
  CHECK(boolean.isBoolean());
  CHECK(boolean.asBoolean());

  const Value str = Value::borrowedString(7);
  CHECK(str.isString());
  CHECK(str.stringRef() == 7);
  CHECK(str.borrowedStringIndex() == 7);
  CHECK((str.stringRef() & kManagedStringRefBit) == 0);

  const Value enumValue = Value::enumSymbol(3, 2);
  CHECK(enumValue.tag() == ValueTag::Enum);
  CHECK(enumValue.typeId() == 3);
  CHECK(enumValue.enumOrdinal() == 2);

  const Value bareFunction = Value::function(9);
  CHECK(bareFunction.tag() == ValueTag::Function);
  CHECK(bareFunction.functionId() == 9);
  CHECK(bareFunction.functionCaptures() == kNoCaptures);

  const Value capturing = Value::function(9, 4);
  CHECK(capturing.functionCaptures() == 4);

  const Value handle = Value::handle(12);
  CHECK(handle.tag() == ValueTag::Handle);
  CHECK(handle.handleId() == 12);

  const Value err = Value::error(ErrorCode::ScriptError);
  CHECK(err.tag() == ValueTag::Err);
  CHECK(err.errorCode() == ErrorCode::ScriptError);
}

TEST_CASE("the managed-string flag bit partitions the reference space") {
  CHECK((kManagedStringRefBit & kStringRefIndexMask) == 0);
  CHECK((kManagedStringRefBit | kStringRefIndexMask) == 0xffffffffu);
}
