#include "doctest/doctest.h"

#include "core/codec/program-reader.h"
#include "core/runtime/buffer-value.h"
#include "core/runtime/load-error.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "fixture-paths.h"
#include "targets/microbit-v2/abi/type-atom-id.h"
#include "vm-harness.h"

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

using wendoo::bufferBytes;
using wendoo::buffersEqual;
using wendoo::ByteSpan;
using wendoo::ConstValue;
using wendoo::ConstValueKind;
using wendoo::isTruthy;
using wendoo::kMicroBitV2TypeAtomIdCount;
using wendoo::LoadError;
using wendoo::Op;
using wendoo::ProgramImage;
using wendoo::ProgramReaderOptions;
using wendoo::readProgramImage;
using wendoo::RegionArena;
using wendoo::Result;
using wendoo::RunResult;
using wendoo::RunStatus;
using wendoo::Span;
using wendoo::Value;
using wendoo::ValueTag;

namespace {

std::vector<uint8_t> readBinaryFile(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  REQUIRE_MESSAGE(stream.good(), "cannot open ", path);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

constexpr ProgramReaderOptions kOptions{kMicroBitV2TypeAtomIdCount};

} // namespace

TEST_CASE("PUSH_CONST_VAL materializes a borrowed buffer value") {
  ProgramBuilder b;
  b.valueBuffer({0x00, 0x7f, 0x80, 0xff});
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  REQUIRE(result.result.tag() == ValueTag::Buffer);
  CHECK(result.result.bufferLength() == 4);
  const ByteSpan bytes = bufferBytes(image, result.result);
  REQUIRE(bytes.size() == 4);
  CHECK(bytes[0] == 0x00);
  CHECK(bytes[1] == 0x7f);
  CHECK(bytes[2] == 0x80);
  CHECK(bytes[3] == 0xff);
}

TEST_CASE("a brain branches on buffer constants through isTruthy") {
  // Push a buffer constant and JMP_IF_FALSE selects a numeric result: a
  // non-empty buffer is truthy (10), an empty buffer is falsy (20).
  auto branchResult = [](std::initializer_list<uint8_t> bytes) -> float {
    ProgramBuilder b;
    b.valueBuffer(bytes);
    b.number(10.0f).number(20.0f);
    b.beginFunction()
        .instr(Op::PUSH_CONST_VAL, 0)
        .instr(Op::JMP_IF_FALSE, 3)   // index 1; falsy jumps to index 4
        .instr(Op::PUSH_CONST_NUM, 0) // index 2: 10.0 (truthy path)
        .instr(Op::RET)               // index 3
        .instr(Op::PUSH_CONST_NUM, 1) // index 4: 20.0 (falsy path)
        .instr(Op::RET);              // index 5
    std::vector<uint8_t> storage(16 * 1024);
    const ProgramImage image = b.build(storage);
    Machine machine;
    const RunResult result = runProgram(machine, image);
    REQUIRE(result.status == RunStatus::Done);
    return result.result.asNumber();
  };

  CHECK(branchResult({0x01, 0x02, 0x03}) == 10.0f);
  CHECK(branchResult({}) == 20.0f);
}

TEST_CASE("the buffer-vectors fixture exposes truthiness and byte-for-byte equality") {
  const std::string base = std::string(wendoo::test::kCoreFixturesDir) + "/buffer-vectors";
  const std::vector<uint8_t> wire = readBinaryFile(base + ".mcprogram.bin");

  std::vector<uint8_t> storage(64 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  const Result<ProgramImage, LoadError> decoded =
      readProgramImage(ByteSpan(wire.data(), wire.size()), arena, kOptions);
  REQUIRE(decoded.isOk());
  const ProgramImage& image = decoded.value();
  REQUIRE(image.constantPools.valueCount == 7);

  auto bufferAt = [&](uint32_t poolIndex) -> Value {
    const ConstValue& constant = image.constValues[poolIndex];
    REQUIRE(constant.kind == ConstValueKind::Buffer);
    return Value::borrowedBuffer(constant.buffer.byteOffset, constant.buffer.byteCount);
  };

  // value 0 is the empty buffer (falsy); value 1 is a single byte (truthy).
  CHECK_FALSE(isTruthy(bufferAt(0), image));
  CHECK(isTruthy(bufferAt(1), image));

  // The equality triple: value 4 and value 5 hold `010203`; value 6 holds
  // `010204`.
  CHECK(buffersEqual(image, bufferAt(4), bufferAt(5)));
  CHECK_FALSE(buffersEqual(image, bufferAt(4), bufferAt(6)));
  CHECK(buffersEqual(image, bufferAt(0), bufferAt(0)));
}
