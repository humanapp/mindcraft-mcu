#include "doctest/doctest.h"

#include "core/runtime/load-error.h"

#include <cstdint>
#include <iterator>

using mindcraft::kLoadErrorNames;
using mindcraft::LoadError;
using mindcraft::loadErrorName;

TEST_CASE("LoadError values are stable") {
  CHECK(static_cast<uint16_t>(LoadError::Truncated) == 1);
  CHECK(static_cast<uint16_t>(LoadError::VarIntOverflow) == 2);
  CHECK(static_cast<uint16_t>(LoadError::InvalidMagic) == 3);
  CHECK(static_cast<uint16_t>(LoadError::UnsupportedFormatVersion) == 4);
  CHECK(static_cast<uint16_t>(LoadError::F64OnF32Target) == 5);
  CHECK(static_cast<uint16_t>(LoadError::InvalidNumberDiscriminant) == 6);
  CHECK(static_cast<uint16_t>(LoadError::InvalidValueTag) == 7);
  CHECK(static_cast<uint16_t>(LoadError::UnknownOpcode) == 8);
  CHECK(static_cast<uint16_t>(LoadError::InvalidTypeEntryTag) == 9);
  CHECK(static_cast<uint16_t>(LoadError::TypeForwardReference) == 10);
  CHECK(static_cast<uint16_t>(LoadError::TypeIndexOutOfRange) == 11);
  CHECK(static_cast<uint16_t>(LoadError::EnumOrdinalOutOfRange) == 12);
  CHECK(static_cast<uint16_t>(LoadError::UnknownTypeAtom) == 13);
  CHECK(static_cast<uint16_t>(LoadError::ArenaExhausted) == 14);
  CHECK(static_cast<uint16_t>(LoadError::UnsupportedDeviceProfile) == 15);
}

TEST_CASE("name table covers every declared code in declaration order") {
  REQUIRE(std::size(kLoadErrorNames) == 15);
  CHECK(kLoadErrorNames[0].code == LoadError::Truncated);
  CHECK(kLoadErrorNames[1].code == LoadError::VarIntOverflow);
  CHECK(kLoadErrorNames[2].code == LoadError::InvalidMagic);
  CHECK(kLoadErrorNames[3].code == LoadError::UnsupportedFormatVersion);
  CHECK(kLoadErrorNames[4].code == LoadError::F64OnF32Target);
  CHECK(kLoadErrorNames[5].code == LoadError::InvalidNumberDiscriminant);
  CHECK(kLoadErrorNames[6].code == LoadError::InvalidValueTag);
  CHECK(kLoadErrorNames[7].code == LoadError::UnknownOpcode);
  CHECK(kLoadErrorNames[8].code == LoadError::InvalidTypeEntryTag);
  CHECK(kLoadErrorNames[9].code == LoadError::TypeForwardReference);
  CHECK(kLoadErrorNames[10].code == LoadError::TypeIndexOutOfRange);
  CHECK(kLoadErrorNames[11].code == LoadError::EnumOrdinalOutOfRange);
  CHECK(kLoadErrorNames[12].code == LoadError::UnknownTypeAtom);
  CHECK(kLoadErrorNames[13].code == LoadError::ArenaExhausted);
  CHECK(kLoadErrorNames[14].code == LoadError::UnsupportedDeviceProfile);

  // Each row's code is a distinct declared member with consecutive values.
  for (size_t i = 0; i < std::size(kLoadErrorNames); i++) {
    CHECK(static_cast<uint16_t>(kLoadErrorNames[i].code) == i + 1);
  }
}

TEST_CASE("loadErrorName returns canonical names") {
  CHECK(loadErrorName(LoadError::Truncated) == doctest::String("Truncated"));
  CHECK(loadErrorName(LoadError::VarIntOverflow) == doctest::String("VarIntOverflow"));
  CHECK(loadErrorName(LoadError::InvalidMagic) == doctest::String("InvalidMagic"));
  CHECK(loadErrorName(LoadError::UnsupportedFormatVersion) ==
        doctest::String("UnsupportedFormatVersion"));
  CHECK(loadErrorName(LoadError::F64OnF32Target) == doctest::String("F64OnF32Target"));
  CHECK(loadErrorName(LoadError::InvalidNumberDiscriminant) ==
        doctest::String("InvalidNumberDiscriminant"));
  CHECK(loadErrorName(LoadError::InvalidValueTag) == doctest::String("InvalidValueTag"));
  CHECK(loadErrorName(LoadError::UnknownOpcode) == doctest::String("UnknownOpcode"));
  CHECK(loadErrorName(LoadError::InvalidTypeEntryTag) == doctest::String("InvalidTypeEntryTag"));
  CHECK(loadErrorName(LoadError::TypeForwardReference) == doctest::String("TypeForwardReference"));
  CHECK(loadErrorName(LoadError::TypeIndexOutOfRange) == doctest::String("TypeIndexOutOfRange"));
  CHECK(loadErrorName(LoadError::EnumOrdinalOutOfRange) ==
        doctest::String("EnumOrdinalOutOfRange"));
  CHECK(loadErrorName(LoadError::UnknownTypeAtom) == doctest::String("UnknownTypeAtom"));
  CHECK(loadErrorName(LoadError::ArenaExhausted) == doctest::String("ArenaExhausted"));
  CHECK(loadErrorName(LoadError::UnsupportedDeviceProfile) ==
        doctest::String("UnsupportedDeviceProfile"));
}

TEST_CASE("loadErrorName returns nullptr for undeclared values") {
  CHECK(loadErrorName(static_cast<LoadError>(0)) == nullptr);
  CHECK(loadErrorName(static_cast<LoadError>(16)) == nullptr);
}
