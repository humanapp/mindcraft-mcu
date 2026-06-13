#include "doctest/doctest.h"

#include "core/codec/program-dump.h"
#include "core/codec/program-reader.h"
#include "core/runtime/load-error.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "fixture-paths.h"
#include "string-sink.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

using mindcraft::ByteSpan;
using mindcraft::ConstValueKind;
using mindcraft::Instr;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::LoadError;
using mindcraft::Op;
using mindcraft::ProgramImage;
using mindcraft::ProgramReaderOptions;
using mindcraft::readProgramImage;
using mindcraft::RegionArena;
using mindcraft::Result;
using mindcraft::Span;
using mindcraft::writeCanonicalProgramDump;

namespace {

std::vector<uint8_t> readBinaryFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

std::string readTextFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::string(std::istreambuf_iterator<char>(stream), std::istreambuf_iterator<char>());
}

constexpr ProgramReaderOptions kOptions{kMicroBitV2TypeAtomIdCount};

/** One committed binary fixture and its golden canonical dump. */
struct Fixture {
  const char* dir;
  const char* name;
};

constexpr Fixture kFixtures[] = {
    {mindcraft::test::kCoreFixturesDir, "struct-field-access"},
    {mindcraft::test::kCoreFixturesDir, "control-flow"},
    {mindcraft::test::kCoreFixturesDir, "values-and-collections"},
    {mindcraft::test::kWodalFixturesDir, "button-display"},
    {mindcraft::test::kWodalFixturesDir, "user-tile-button-display"},
};

} // namespace

TEST_CASE("every committed fixture decodes and byte-matches its golden dump") {
  for (const Fixture& fixture : kFixtures) {
    CAPTURE(fixture.name);
    const std::string base = std::string(fixture.dir) + "/" + fixture.name;
    const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");
    const std::string golden = readTextFile(base + ".mcprogram.dump");

    std::vector<uint8_t> storage(256 * 1024);
    RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
    const Result<ProgramImage, LoadError> decoded =
        readProgramImage(ByteSpan(wire.data(), wire.size()), arena, kOptions);
    REQUIRE(decoded.isOk());

    StringTextSink sink;
    REQUIRE(writeCanonicalProgramDump(decoded.value(), sink));
    CHECK(sink.text() == golden);
  }
}

TEST_CASE("the dump rendering is deterministic") {
  const std::string base =
      std::string(mindcraft::test::kCoreFixturesDir) + "/values-and-collections";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");

  std::vector<uint8_t> storage(256 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, kOptions);
  REQUIRE(decoded.isOk());

  StringTextSink first;
  StringTextSink second;
  REQUIRE(writeCanonicalProgramDump(decoded.value(), first));
  REQUIRE(writeCanonicalProgramDump(decoded.value(), second));
  CHECK(first.text() == second.text());
}

TEST_CASE("a fixture decode into a too-small arena fails ArenaExhausted") {
  const std::string base = std::string(mindcraft::test::kWodalFixturesDir) + "/button-display";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");

  std::vector<uint8_t> storage(16);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, kOptions);
  REQUIRE(!decoded.isOk());
  CHECK(decoded.error() == LoadError::ArenaExhausted);
}

TEST_CASE("an image with an undeclared opcode is unrenderable") {
  Instr instr{static_cast<Op>(7), 0, 0, 0};
  mindcraft::FunctionBytecode fn{0, 1, 0, 0, mindcraft::kNoTypeIdx};
  ProgramImage image{};
  image.instructions = {&instr, 1};
  image.functions = {&fn, 1};

  StringTextSink sink;
  CHECK(!writeCanonicalProgramDump(image, sink));
}
