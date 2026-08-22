#include "doctest/doctest.h"

#include "core/codec/program-reader.h"
#include "core/runtime/load-error.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "fixture-paths.h"
#include "hostkit/program-dump.h"
#include "string-sink.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

using wendoo::ByteSpan;
using wendoo::ConstValueKind;
using wendoo::Instr;
using wendoo::kMicroBitV2TypeAtomIdCount;
using wendoo::LoadError;
using wendoo::Op;
using wendoo::ProgramImage;
using wendoo::ProgramReaderOptions;
using wendoo::readProgramImage;
using wendoo::RegionArena;
using wendoo::Result;
using wendoo::Span;
using wendoo::writeCanonicalProgramDump;

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
    {wendoo::test::kCoreFixturesDir, "struct-field-access"},
    {wendoo::test::kCoreFixturesDir, "control-flow"},
    {wendoo::test::kCoreFixturesDir, "values-and-collections"},
    {wendoo::test::kCoreFixturesDir, "buffer-vectors"},
    {wendoo::test::kWodalFixturesDir, "button-display"},
    {wendoo::test::kWodalFixturesDir, "user-tile-button-display"},
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
  const std::string base = std::string(wendoo::test::kCoreFixturesDir) + "/values-and-collections";
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
  const std::string base = std::string(wendoo::test::kWodalFixturesDir) + "/button-display";
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
  wendoo::FunctionBytecode fn{0, 1, 0, 0, wendoo::kNoTypeIdx};
  ProgramImage image{};
  image.instructions = {&instr, 1};
  image.functions = {&fn, 1};

  StringTextSink sink;
  CHECK(!writeCanonicalProgramDump(image, sink));
}
