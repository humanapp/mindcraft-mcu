#pragma once

#include "doctest/doctest.h"

#include "core/codec/program-reader.h"
#include "core/platform/span.h"
#include "core/runtime/load-error.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/result.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <cstdint>
#include <cstring>
#include <vector>

/** Builds binary `.mcprogram` payloads with the codec's wire primitives. */
class WireBuilder {
public:
  WireBuilder& u8(uint8_t value) {
    bytes_.push_back(value);
    return *this;
  }

  WireBuilder& varUint(uint32_t value) {
    while (value >= 0x80) {
      bytes_.push_back(static_cast<uint8_t>((value & 0x7f) | 0x80));
      value >>= 7;
    }
    bytes_.push_back(static_cast<uint8_t>(value));
    return *this;
  }

  WireBuilder& varInt(int32_t value) {
    const uint32_t zigzag =
        (static_cast<uint32_t>(value) << 1) ^ static_cast<uint32_t>(value >> 31);
    return varUint(zigzag);
  }

  WireBuilder& f32(float value) {
    uint32_t bits = 0;
    memcpy(&bits, &value, sizeof(bits));
    for (int i = 0; i < 4; i++) {
      bytes_.push_back(static_cast<uint8_t>(bits >> (8 * i)));
    }
    return *this;
  }

  WireBuilder& raw(mindcraft::ByteSpan bytes) {
    for (size_t i = 0; i < bytes.size(); i++) {
      bytes_.push_back(bytes[i]);
    }
    return *this;
  }

  WireBuilder& str(const char* value) {
    const size_t length = strlen(value);
    varUint(static_cast<uint32_t>(length));
    for (size_t i = 0; i < length; i++) {
      bytes_.push_back(static_cast<uint8_t>(value[i]));
    }
    return *this;
  }

  mindcraft::ByteSpan span() const { return mindcraft::ByteSpan(bytes_.data(), bytes_.size()); }

private:
  std::vector<uint8_t> bytes_;
};

/** Magic, the reader's format version, profileId, presence bitmask. */
inline WireBuilder programHeader(uint8_t presence = 0, uint32_t profileId = 0) {
  WireBuilder w;
  w.u8(0x89)
      .u8('M')
      .u8('B')
      .u8('P')
      .u8(mindcraft::kBinaryProgramFormatVersion)
      .varUint(profileId)
      .u8(presence);
  return w;
}

/**
 * Appends one `VARS` slot: the name's string index, then the starting value's
 * `CVAL` index biased by one, or `0` for a slot with no starting value.
 */
inline void varsSlot(WireBuilder& w, uint32_t nameIdx, uint32_t biasedInitIdx = 0) {
  w.varUint(nameIdx).varUint(biasedInitIdx);
}

/** Appends empty CSTR, TYPS, CNUM, CVAL, FUNC, and VARS sections. */
inline void emptyRequiredSectionsThroughVars(WireBuilder& w) {
  w.varUint(0).varUint(0); // CSTR: total, constStringCount
  w.varUint(0);            // TYPS
  w.varUint(0);            // CNUM
  w.varUint(0);            // CVAL
  w.varUint(0);            // FUNC
  w.varUint(0);            // VARS
}

/** Decodes `wire` into `storage` with the microbit-v2 atom-table options. */
inline mindcraft::Result<mindcraft::ProgramImage, mindcraft::LoadError>
decode(const WireBuilder& wire, std::vector<uint8_t>& storage) {
  constexpr mindcraft::ProgramReaderOptions options{mindcraft::kMicroBitV2TypeAtomIdCount};
  mindcraft::RegionArena arena(mindcraft::Span<uint8_t>(storage.data(), storage.size()));
  return mindcraft::readProgramImage(wire.span(), arena, options);
}

/** Decodes `wire`, requiring failure, and returns the load error. */
inline mindcraft::LoadError decodeError(const WireBuilder& wire) {
  std::vector<uint8_t> storage(16 * 1024);
  const auto result = decode(wire, storage);
  REQUIRE(!result.isOk());
  return result.error();
}

/** Decodes `wire`, requiring success, and returns the image backed by `storage`. */
inline mindcraft::ProgramImage decodeOk(const WireBuilder& wire, std::vector<uint8_t>& storage) {
  const auto result = decode(wire, storage);
  REQUIRE(result.isOk());
  return result.value();
}
