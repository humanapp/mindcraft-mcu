#include "doctest/doctest.h"

#include "core/codec/program-reader.h"
#include "core/runtime/bytecode.h"
#include "core/runtime/core-func-id.h"
#include "core/runtime/core-host-actions.h"
#include "core/runtime/host-action.h"
#include "core/runtime/host-actions/core-host-action-bindings.h"
#include "core/runtime/host-actions/core-host-action-env.h"
#include "core/runtime/region-arena.h"
#include "fixture-paths.h"
#include "targets/microbit-v2/abi/type-atom-id.h"

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using mindcraft::ByteSpan;
using mindcraft::CoreFuncId;
using mindcraft::CoreHostActionEnv;
using mindcraft::findHostActionById;
using mindcraft::HostActionBinding;
using mindcraft::kMicroBitV2TypeAtomIdCount;
using mindcraft::kOperandSchema;
using mindcraft::LoadError;
using mindcraft::Op;
using mindcraft::OpOperandSchema;
using mindcraft::ProgramImage;
using mindcraft::ProgramReaderOptions;
using mindcraft::readProgramImage;
using mindcraft::RegionArena;
using mindcraft::Result;
using mindcraft::Span;

namespace {

/**
 * Dispatch surface that realizes a {@link CoreFuncId}. Every contract core
 * function is reachable through exactly one of these; `Unsupported` is the
 * carve-out class (a lowering target that would fall to a `default ->
 * unsupported()` arm), which must stay empty.
 */
enum class CoreFuncDispatch : uint8_t {
  /** A `HOST_CALL` body in `callCoreHostFunction` (operators, conversions,
     builtins, math, string, list, map). */
  HostCall,
  /** The `HOST_CALL` context-variable path in vm.cpp (`ctx.brain` / `ctx.rule`
     get/set). */
  ContextVariable,
  /** A core host-action `fnId`: dispatched through the host-action table by
     `HOST_ACTION_CALL`. */
  HostAction,
  /** Not realized by any surface - the carve-out the gate forbids. */
  Unsupported,
};

// The explicit, reviewable classification manifest. A core function added to the
// contract without a dispatch arm falls through to `Unsupported`, failing the
// carve-out gate until it is implemented or consciously reclassified here.
CoreFuncDispatch coreFuncDispatch(CoreFuncId id) {
  switch (id) {
  case CoreFuncId::OpAndBoolean:
  case CoreFuncId::OpOrBoolean:
  case CoreFuncId::OpNotBoolean:
  case CoreFuncId::OpAddNumber:
  case CoreFuncId::OpSubtractNumber:
  case CoreFuncId::OpMultiplyNumber:
  case CoreFuncId::OpDivideNumber:
  case CoreFuncId::OpModuloNumber:
  case CoreFuncId::OpPowerNumber:
  case CoreFuncId::OpNegateNumber:
  case CoreFuncId::OpBitwiseAndNumber:
  case CoreFuncId::OpBitwiseOrNumber:
  case CoreFuncId::OpBitwiseXorNumber:
  case CoreFuncId::OpBitwiseNotNumber:
  case CoreFuncId::OpLeftShiftNumber:
  case CoreFuncId::OpRightShiftNumber:
  case CoreFuncId::OpEqualToBoolean:
  case CoreFuncId::OpNotEqualToBoolean:
  case CoreFuncId::OpEqualToNumber:
  case CoreFuncId::OpNotEqualToNumber:
  case CoreFuncId::OpLessThanNumber:
  case CoreFuncId::OpLessThanOrEqualToNumber:
  case CoreFuncId::OpGreaterThanNumber:
  case CoreFuncId::OpGreaterThanOrEqualToNumber:
  case CoreFuncId::OpAddString:
  case CoreFuncId::OpEqualToString:
  case CoreFuncId::OpNotEqualToString:
  case CoreFuncId::OpEqualToNil:
  case CoreFuncId::OpNotEqualToNil:
  case CoreFuncId::OpNotNil:
  case CoreFuncId::OpEqualToNumberNil:
  case CoreFuncId::OpEqualToNilNumber:
  case CoreFuncId::OpNotEqualToNumberNil:
  case CoreFuncId::OpNotEqualToNilNumber:
  case CoreFuncId::OpEqualToBooleanNil:
  case CoreFuncId::OpEqualToNilBoolean:
  case CoreFuncId::OpNotEqualToBooleanNil:
  case CoreFuncId::OpNotEqualToNilBoolean:
  case CoreFuncId::OpEqualToStringNil:
  case CoreFuncId::OpEqualToNilString:
  case CoreFuncId::OpNotEqualToStringNil:
  case CoreFuncId::OpNotEqualToNilString:
  case CoreFuncId::ConvNumberToString:
  case CoreFuncId::ConvStringToNumber:
  case CoreFuncId::ConvNumberToBoolean:
  case CoreFuncId::ConvBooleanToNumber:
  case CoreFuncId::ConvStringToBoolean:
  case CoreFuncId::ConvBooleanToString:
  case CoreFuncId::ListGet:
  case CoreFuncId::StringGet:
  case CoreFuncId::MapKeys:
  case CoreFuncId::MapValues:
  case CoreFuncId::MapSize:
  case CoreFuncId::MapClear:
  case CoreFuncId::MathAbs:
  case CoreFuncId::MathAcos:
  case CoreFuncId::MathAsin:
  case CoreFuncId::MathAtan:
  case CoreFuncId::MathAtan2:
  case CoreFuncId::MathCeil:
  case CoreFuncId::MathCos:
  case CoreFuncId::MathExp:
  case CoreFuncId::MathFloor:
  case CoreFuncId::MathLog:
  case CoreFuncId::MathMax:
  case CoreFuncId::MathMin:
  case CoreFuncId::MathPow:
  case CoreFuncId::MathRandom:
  case CoreFuncId::MathRound:
  case CoreFuncId::MathSin:
  case CoreFuncId::MathSqrt:
  case CoreFuncId::MathTan:
  case CoreFuncId::StrLength:
  case CoreFuncId::StrCharAt:
  case CoreFuncId::StrCharCodeAt:
  case CoreFuncId::StrIndexOf:
  case CoreFuncId::StrLastIndexOf:
  case CoreFuncId::StrSlice:
  case CoreFuncId::StrSubstring:
  case CoreFuncId::StrToLowerCase:
  case CoreFuncId::StrToUpperCase:
  case CoreFuncId::StrTrim:
  case CoreFuncId::StrSplit:
  case CoreFuncId::StrConcat:
  case CoreFuncId::BufferFrom:
  case CoreFuncId::BufferFromHex:
  case CoreFuncId::BufferFromString:
  case CoreFuncId::BufferLength:
  case CoreFuncId::BufferGet:
    return CoreFuncDispatch::HostCall;
  case CoreFuncId::BrainContextGetVariable:
  case CoreFuncId::BrainContextSetVariable:
  case CoreFuncId::RuleContextGetVariable:
  case CoreFuncId::RuleContextSetVariable:
    return CoreFuncDispatch::ContextVariable;
  case CoreFuncId::SensorRandom:
  case CoreFuncId::SensorOnPageEntered:
  case CoreFuncId::SensorTimeout:
  case CoreFuncId::SensorCurrentPage:
  case CoreFuncId::SensorPreviousPage:
  case CoreFuncId::ActuatorSwitchPage:
  case CoreFuncId::ActuatorRestartPage:
  case CoreFuncId::ActuatorYield:
    return CoreFuncDispatch::HostAction;
  }
  return CoreFuncDispatch::Unsupported;
}

} // namespace

TEST_CASE(
    "every core host function is realized by a dispatch surface (carve-out allow-list empty)") {
  // Surface (a) of the carve-out gate: no contract CoreFuncId falls to
  // HOST_CALL's default -> unsupported() path. The set of unsupported lowering
  // targets must equal the empty allow-list.
  for (uint32_t i = 0; i < mindcraft::kCoreFuncIdCount; i++) {
    CAPTURE(i);
    CHECK(coreFuncDispatch(static_cast<CoreFuncId>(i)) != CoreFuncDispatch::Unsupported);
  }
}

TEST_CASE("every dispatchable core host-action id has a registered binding") {
  // Surface (b) of the carve-out gate: every core host-action id a program can
  // dispatch through HOST_ACTION_CALL has a binding with a body in the firmware
  // action table. A binding "exists" means a body is present, not merely an id
  // declared.
  CoreHostActionEnv env;
  const std::array<HostActionBinding, mindcraft::kCoreHostActionBindingCount> bindings =
      mindcraft::makeCoreHostActionBindings(env);
  const mindcraft::Span<const HostActionBinding> table(bindings.data(), bindings.size());

  for (const mindcraft::HostActionIds& action : mindcraft::kCoreHostActions) {
    CAPTURE(action.actionId);
    const HostActionBinding* binding = findHostActionById(table, action.actionId);
    REQUIRE(binding != nullptr);
    CHECK((binding->execSync != nullptr || binding->execAsync != nullptr));
    // Each core action's fnId is a core function realized through the host-action
    // surface, tying the two carve-out surfaces together.
    CHECK(coreFuncDispatch(static_cast<CoreFuncId>(action.fnId)) == CoreFuncDispatch::HostAction);
  }
}

namespace {

// The two reserved opcode numbers carry no VM handler and so never appear in a
// compiled program.
bool isReservedOp(Op op) { return op == Op::RESERVED_111 || op == Op::RESERVED_112; }

std::vector<uint8_t> readFileBytes(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary);
  return std::vector<uint8_t>(std::istreambuf_iterator<char>(stream),
                              std::istreambuf_iterator<char>());
}

} // namespace

TEST_CASE("the golden program set exercises every contract opcode") {
  // Opcode-coverage measurement: union the opcodes present across every committed
  // golden program. The parity suite runs these programs through full tick
  // schedules, so an opcode present in the corpus is an opcode the suite exercises
  // on both VMs. A contract opcode missing here means no golden covers it - a
  // conformance-targeted brain must be authored to fill the gap.
  bool seen[256] = {};
  std::vector<uint8_t> arenaStorage(256 * 1024);

  const std::filesystem::path fixtures(mindcraft::test::kWodalFixturesDir);
  uint32_t programs = 0;
  for (const std::filesystem::directory_entry& entry :
       std::filesystem::directory_iterator(fixtures)) {
    const std::filesystem::path& path = entry.path();
    const std::string name = path.filename().string();
    const std::string suffix = ".mcprogram.bin";
    if (name.size() < suffix.size() ||
        name.compare(name.size() - suffix.size(), suffix.size(), suffix) != 0) {
      continue;
    }
    const std::vector<uint8_t> wire = readFileBytes(path);
    RegionArena arena(Span<uint8_t>(arenaStorage.data(), arenaStorage.size()));
    constexpr ProgramReaderOptions options{kMicroBitV2TypeAtomIdCount};
    const Result<ProgramImage, LoadError> decoded =
        readProgramImage(ByteSpan(wire.data(), wire.size()), arena, options);
    REQUIRE_MESSAGE(decoded.isOk(), "cannot decode golden ", name);
    for (size_t i = 0; i < decoded.value().instructions.size(); i++) {
      seen[static_cast<uint8_t>(decoded.value().instructions[i].op)] = true;
    }
    programs++;
  }
  REQUIRE(programs > 0);

  for (const OpOperandSchema& row : kOperandSchema) {
    if (isReservedOp(row.op)) {
      continue;
    }
    // HOST_CALL_ASYNC has no microbit-v2 async host function for the compiler to
    // target, so no golden program can dispatch it; it is exercised by the
    // async-handles unit tests instead.
    if (row.op == Op::HOST_CALL_ASYNC) {
      CHECK_FALSE(seen[static_cast<uint8_t>(row.op)]);
      continue;
    }
    CAPTURE(static_cast<int>(row.op));
    CHECK(seen[static_cast<uint8_t>(row.op)]);
  }
}
