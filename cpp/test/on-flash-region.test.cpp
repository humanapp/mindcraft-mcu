#include "doctest/doctest.h"

#include "codal/on-flash-region.h"
#include "core/codec/program-reader.h"
#include "core/runtime/load-error.h"
#include "core/runtime/region-arena.h"
#include "fixture-paths.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <cstdint>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

using mindcraft::ByteSpan;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::kOnFlashFormatVersion;
using mindcraft::kRegionHeaderSize;
using mindcraft::kRegionMagicBytes;
using mindcraft::LoadError;
using mindcraft::ProgramImage;
using mindcraft::ProgramReaderOptions;
using mindcraft::readRegionProgram;
using mindcraft::RegionArena;
using mindcraft::RegionError;
using mindcraft::Result;
using mindcraft::Span;

namespace {

std::vector<uint8_t> readBinaryFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

/**
 * Build a written region: the header (magic + format version) over `payload`,
 * padded with the erased pattern (`0xff`) up to `regionSize` - the region
 * format the boot path reads.
 */
std::vector<uint8_t> buildRegion(ByteSpan payload, size_t regionSize) {
  REQUIRE(regionSize >= kRegionHeaderSize + payload.size());
  std::vector<uint8_t> region(regionSize, 0xff);
  std::memcpy(region.data(), kRegionMagicBytes, sizeof(kRegionMagicBytes));
  region[4] = kOnFlashFormatVersion;
  std::memcpy(region.data() + kRegionHeaderSize, payload.data(), payload.size());
  return region;
}

} // namespace

TEST_CASE("a valid region yields a payload the program reader decodes") {
  const std::vector<uint8_t> payload = readBinaryFile(
      std::string(mindcraft::test::kWodalFixturesDir) + "/button-display.mcprogram.bin");
  REQUIRE_FALSE(payload.empty());
  const std::vector<uint8_t> region =
      buildRegion(ByteSpan(payload.data(), payload.size()), 32 * 1024);

  const Result<ByteSpan, RegionError> program =
      readRegionProgram(ByteSpan(region.data(), region.size()));
  REQUIRE(program.isOk());
  // The span includes the erased tail; compare only the program bytes.
  CHECK(std::memcmp(program.value().data(), payload.data(), payload.size()) == 0);

  std::vector<uint8_t> arenaStorage(32 * 1024);
  RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
  constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount};
  const Result<ProgramImage, LoadError> decoded = readProgramImage(program.value(), arena, options);
  CHECK(decoded.isOk());
}

TEST_CASE("an erased region reports no program") {
  std::vector<uint8_t> region(32 * 1024, 0xff);
  const Result<ByteSpan, RegionError> program =
      readRegionProgram(ByteSpan(region.data(), region.size()));
  REQUIRE_FALSE(program.isOk());
  CHECK(program.error() == RegionError::NoProgram);
}

TEST_CASE("a region too small for a header reports no program") {
  std::vector<uint8_t> region(kRegionHeaderSize - 1, 0x00);
  const Result<ByteSpan, RegionError> program =
      readRegionProgram(ByteSpan(region.data(), region.size()));
  REQUIRE_FALSE(program.isOk());
  CHECK(program.error() == RegionError::NoProgram);
}

TEST_CASE("a foreign magic is rejected") {
  std::vector<uint8_t> region(32 * 1024, 0x00); // zeroed: not erased, not our magic
  const Result<ByteSpan, RegionError> program =
      readRegionProgram(ByteSpan(region.data(), region.size()));
  REQUIRE_FALSE(program.isOk());
  CHECK(program.error() == RegionError::InvalidMagic);
}

TEST_CASE("an unsupported format version is rejected") {
  const uint8_t payload[] = {0x01, 0x02, 0x03, 0x04};
  std::vector<uint8_t> region = buildRegion(ByteSpan(payload, sizeof(payload)), 64);
  region[4] = kOnFlashFormatVersion + 1;
  const Result<ByteSpan, RegionError> program =
      readRegionProgram(ByteSpan(region.data(), region.size()));
  REQUIRE_FALSE(program.isOk());
  CHECK(program.error() == RegionError::UnsupportedFormatVersion);
}
