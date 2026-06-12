#include "doctest/doctest.h"

#include "core/runtime/bytecode.h"
#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/execution-state.h"
#include "core/runtime/program.h"
#include "core/runtime/stack-pool.h"
#include "core/runtime/value.h"
#include "core/runtime/vm.h"
#include "wire-builder.h"

#include <array>
#include <cstdint>
#include <limits>
#include <vector>

using mindcraft::CoreTypeAtomId;
using mindcraft::ErrorCode;
using mindcraft::ExecutionState;
using mindcraft::Frame;
using mindcraft::FunctionBytecode;
using mindcraft::Instr;
using mindcraft::isTruthy;
using mindcraft::kFalseValue;
using mindcraft::kMaxFrameDepth;
using mindcraft::kMaxHandlers;
using mindcraft::kMaxHandles;
using mindcraft::kMaxLocalsSize;
using mindcraft::kMaxStackSize;
using mindcraft::kNilValue;
using mindcraft::kNoCaptures;
using mindcraft::kNoFuncId;
using mindcraft::kNoTypeIdx;
using mindcraft::kOperandSchema;
using mindcraft::kTrueValue;
using mindcraft::Op;
using mindcraft::OperandEncoding;
using mindcraft::operandSchemaFor;
using mindcraft::OperandSpec;
using mindcraft::OpOperandSchema;
using mindcraft::ProgramImage;
using mindcraft::runExecution;
using mindcraft::RunResult;
using mindcraft::RunStatus;
using mindcraft::Span;
using mindcraft::StackRegionPool;
using mindcraft::startExecution;
using mindcraft::Status;
using mindcraft::Value;
using mindcraft::ValueTag;

namespace {

/**
 * Composes a synthetic program section by section and decodes it into a
 * {@link ProgramImage} for dispatch-loop tests.
 */
class ProgramBuilder {
public:
  /** Appends a constant-pool string and returns the builder. */
  ProgramBuilder& poolString(const char* value) {
    strings_.push_back(value);
    return *this;
  }

  /** Appends an atom type-table entry. */
  ProgramBuilder& atomType(CoreTypeAtomId atomId) {
    typeCount_++;
    types_.u8(0).varUint(static_cast<uint32_t>(atomId));
    return *this;
  }

  /** Appends a list type-table entry over element type `elemTypeIdx`. */
  ProgramBuilder& listType(uint32_t elemTypeIdx) {
    typeCount_++;
    types_.u8(1).varUint(elemTypeIdx);
    return *this;
  }

  /** Appends a number constant-pool entry. */
  ProgramBuilder& number(float value) {
    numberCount_++;
    numbers_.u8(1).f32(value);
    return *this;
  }

  /** Appends a nil value constant. */
  ProgramBuilder& valueNil() {
    valueCount_++;
    values_.u8(1);
    return *this;
  }

  /** Appends a void value constant. */
  ProgramBuilder& valueVoid() {
    valueCount_++;
    values_.u8(0);
    return *this;
  }

  /** Appends an unknown value constant. */
  ProgramBuilder& valueUnknown() {
    valueCount_++;
    values_.u8(0xff);
    return *this;
  }

  /** Appends a boolean value constant. */
  ProgramBuilder& valueBool(bool value) {
    valueCount_++;
    values_.u8(2).u8(value ? 1 : 0);
    return *this;
  }

  /** Appends a number value constant. */
  ProgramBuilder& valueNumber(float value) {
    valueCount_++;
    values_.u8(3).u8(1).f32(value);
    return *this;
  }

  /** Appends a string value constant referencing string-table entry `stringIdx`. */
  ProgramBuilder& valueString(uint32_t stringIdx) {
    valueCount_++;
    values_.u8(4).varUint(stringIdx);
    return *this;
  }

  /** Appends an enum value constant. */
  ProgramBuilder& valueEnum(uint32_t typeIdx, uint32_t ordinal) {
    valueCount_++;
    values_.u8(5).varUint(typeIdx).varUint(ordinal);
    return *this;
  }

  /** Appends a captureless function value constant. */
  ProgramBuilder& valueFunction(uint32_t funcId) {
    valueCount_++;
    values_.u8(11).varUint(funcId).varUint(0);
    return *this;
  }

  /** Appends an empty list value constant of list type `typeIdx`. */
  ProgramBuilder& valueEmptyList(uint32_t typeIdx) {
    valueCount_++;
    values_.u8(6).varUint(typeIdx).varUint(0);
    return *this;
  }

  /** Opens a new function; subsequent {@link instr} calls fill its body. */
  ProgramBuilder& beginFunction(uint32_t numParams = 0, uint32_t extraLocals = 0) {
    functions_.push_back(FunctionSpec{numParams, extraLocals, 0, WireBuilder()});
    return *this;
  }

  /**
   * Appends one instruction to the open function, encoding the operands the
   * opcode's schema requires (optional trailing operands are encoded absent).
   */
  ProgramBuilder& instr(Op op, int32_t a = 0, int32_t b = 0, int32_t c = 0) {
    const OpOperandSchema* schema = operandSchemaFor(op);
    REQUIRE(schema != nullptr);
    FunctionSpec& fn = functions_.back();
    fn.body.u8(static_cast<uint8_t>(op));
    const int32_t operands[3] = {a, b, c};
    for (uint8_t i = 0; i < schema->operandCount; i++) {
      const OperandSpec& spec = schema->operands[i];
      if (spec.optional) {
        fn.body.varUint(0);
      } else if (spec.encoding == OperandEncoding::SVar) {
        fn.body.varInt(operands[i]);
      } else {
        fn.body.varUint(static_cast<uint32_t>(operands[i]));
      }
    }
    fn.instrCount++;
    return *this;
  }

  /** Encodes every section and decodes the program into `storage`. */
  ProgramImage build(std::vector<uint8_t>& storage) {
    WireBuilder w = programHeader();
    w.varUint(static_cast<uint32_t>(strings_.size()))
        .varUint(static_cast<uint32_t>(strings_.size()));
    for (const char* s : strings_) {
      w.str(s);
    }
    w.varUint(typeCount_).raw(types_.span());
    w.varUint(numberCount_).raw(numbers_.span());
    w.varUint(valueCount_).raw(values_.span());
    w.varUint(static_cast<uint32_t>(functions_.size()));
    for (const FunctionSpec& fn : functions_) {
      w.varUint(fn.numParams).varUint(fn.extraLocals).varUint(0).varUint(fn.instrCount);
      w.raw(fn.body.span());
    }
    w.varUint(0); // VARS
    w.varUint(0); // PAGE
    return decodeOk(w, storage);
  }

private:
  struct FunctionSpec {
    uint32_t numParams;
    uint32_t extraLocals;
    uint32_t instrCount;
    WireBuilder body;
  };

  std::vector<const char*> strings_;
  uint32_t typeCount_ = 0;
  WireBuilder types_;
  uint32_t numberCount_ = 0;
  WireBuilder numbers_;
  uint32_t valueCount_ = 0;
  WireBuilder values_;
  std::vector<FunctionSpec> functions_;
};

/** An execution state bound to its own fixed stack regions. */
struct Machine {
  explicit Machine(uint32_t stackLimit = kMaxStackSize, uint32_t localsLimit = kMaxLocalsSize,
                   uint32_t frameLimit = kMaxFrameDepth) {
    state.stack = stackStorage.data();
    state.stackLimit = stackLimit;
    state.stackDepth = 0;
    state.locals = localsStorage.data();
    state.localsLimit = localsLimit;
    state.localsDepth = 0;
    state.frames = frameStorage.data();
    state.frameLimit = frameLimit;
    state.frameDepth = 0;
    state.budget = 0;
  }

  std::array<Value, kMaxStackSize> stackStorage;
  std::array<Value, kMaxLocalsSize> localsStorage;
  std::array<Frame, kMaxFrameDepth> frameStorage;
  ExecutionState state;
};

/** Starts function 0 with `args` and runs it under `budget`. */
RunResult runProgram(Machine& machine, const ProgramImage& image, Span<const Value> args = {},
                     int32_t budget = 1000) {
  REQUIRE(startExecution(machine.state, image, 0, args).isOk());
  machine.state.budget = budget;
  return runExecution(machine.state, image);
}

/** True for the opcodes the dispatch loop implements. */
bool isImplementedOp(Op op) {
  switch (op) {
  case Op::PUSH_CONST_VAL:
  case Op::POP:
  case Op::DUP:
  case Op::SWAP:
  case Op::PUSH_CONST_NUM:
  case Op::PUSH_CONST_STR:
  case Op::STACK_SET_REL:
  case Op::JMP:
  case Op::JMP_IF_FALSE:
  case Op::JMP_IF_TRUE:
  case Op::RET:
  case Op::WHEN_START:
  case Op::WHEN_END:
  case Op::DO_START:
  case Op::DO_END:
  case Op::LOAD_LOCAL:
  case Op::STORE_LOCAL:
    return true;
  default:
    return false;
  }
}

} // namespace

TEST_CASE("the device caps hold their decided values") {
  CHECK(kMaxStackSize == 256u);
  CHECK(kMaxLocalsSize == 256u);
  CHECK(kMaxFrameDepth == 64u);
  CHECK(kMaxHandlers == 16u);
  CHECK(kMaxHandles == 0u);
}

TEST_CASE("PUSH_CONST_VAL pushes every inline constant kind") {
  ProgramBuilder b;
  b.poolString("hi");
  b.atomType(CoreTypeAtomId::Number);
  b.valueNil().valueVoid().valueUnknown().valueBool(true).valueNumber(2.5f);
  b.valueString(0).valueEnum(0, 2).valueFunction(1);
  const uint32_t kinds = 8;
  for (uint32_t k = 0; k < kinds; k++) {
    b.beginFunction().instr(Op::PUSH_CONST_VAL, static_cast<int32_t>(k)).instr(Op::RET);
  }
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  const auto resultOf = [&](uint32_t funcId) {
    Machine machine;
    REQUIRE(startExecution(machine.state, image, funcId, {}).isOk());
    machine.state.budget = 10;
    const RunResult result = runExecution(machine.state, image);
    REQUIRE(result.status == RunStatus::Done);
    return result.result;
  };

  CHECK(resultOf(0).tag() == ValueTag::Nil);
  CHECK(resultOf(1).tag() == ValueTag::Void);
  CHECK(resultOf(2).tag() == ValueTag::Unknown);
  CHECK(resultOf(3).asBoolean());
  CHECK(resultOf(4).asNumber() == 2.5f);
  const Value str = resultOf(5);
  CHECK(str.tag() == ValueTag::String);
  CHECK(str.borrowedStringIndex() == 0);
  const Value enumValue = resultOf(6);
  CHECK(enumValue.tag() == ValueTag::Enum);
  CHECK(enumValue.typeId() == 0);
  CHECK(enumValue.enumOrdinal() == 2);
  const Value fn = resultOf(7);
  CHECK(fn.tag() == ValueTag::Function);
  CHECK(fn.functionId() == 1);
  CHECK(fn.functionCaptures() == kNoCaptures);
}

TEST_CASE("PUSH_CONST_VAL of a container constant faults ScriptError") {
  ProgramBuilder b;
  b.atomType(CoreTypeAtomId::Number).listType(0);
  b.valueEmptyList(1);
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::ScriptError);
  CHECK(result.site.funcId == 0);
  CHECK(result.site.pc == 0);
}

TEST_CASE("PUSH_CONST_NUM and PUSH_CONST_STR push their pools' entries") {
  ProgramBuilder b;
  b.poolString("abc");
  b.number(-7.25f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::RET);
  b.beginFunction().instr(Op::PUSH_CONST_STR, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine numbers;
  REQUIRE(startExecution(numbers.state, image, 0, {}).isOk());
  numbers.state.budget = 10;
  const RunResult numberResult = runExecution(numbers.state, image);
  REQUIRE(numberResult.status == RunStatus::Done);
  CHECK(numberResult.result.asNumber() == -7.25f);

  Machine strings;
  REQUIRE(startExecution(strings.state, image, 1, {}).isOk());
  strings.state.budget = 10;
  const RunResult stringResult = runExecution(strings.state, image);
  REQUIRE(stringResult.status == RunStatus::Done);
  CHECK(stringResult.result.tag() == ValueTag::String);
  CHECK(stringResult.result.borrowedStringIndex() == 0);
}

TEST_CASE("each PUSH_CONST_* faults ScriptError on an out-of-range index") {
  const Op pushes[3] = {Op::PUSH_CONST_VAL, Op::PUSH_CONST_NUM, Op::PUSH_CONST_STR};
  for (const Op op : pushes) {
    CAPTURE(static_cast<int>(op));
    ProgramBuilder b;
    b.beginFunction().instr(op, 0).instr(Op::RET);
    std::vector<uint8_t> storage(16 * 1024);
    const ProgramImage image = b.build(storage);

    Machine machine;
    const RunResult result = runProgram(machine, image);
    REQUIRE(result.status == RunStatus::Fault);
    CHECK(result.error == ErrorCode::ScriptError);
    CHECK(result.site.pc == 0);
  }
}

TEST_CASE("POP, DUP, and SWAP rearrange the operand stack") {
  ProgramBuilder b;
  b.number(1.0f).number(2.0f);
  // [1, 2] -> SWAP -> [2, 1] -> POP -> [2] -> RET returns 2.
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::SWAP)
      .instr(Op::POP)
      .instr(Op::RET);
  // [1] -> DUP -> [1, 1] -> POP -> [1] -> RET returns 1.
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::DUP).instr(Op::POP).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine swapped;
  REQUIRE(startExecution(swapped.state, image, 0, {}).isOk());
  swapped.state.budget = 10;
  const RunResult swapResult = runExecution(swapped.state, image);
  REQUIRE(swapResult.status == RunStatus::Done);
  CHECK(swapResult.result.asNumber() == 2.0f);

  Machine duped;
  REQUIRE(startExecution(duped.state, image, 1, {}).isOk());
  duped.state.budget = 10;
  const RunResult dupResult = runExecution(duped.state, image);
  REQUIRE(dupResult.status == RunStatus::Done);
  CHECK(dupResult.result.asNumber() == 1.0f);
}

TEST_CASE("STACK_SET_REL fills an arg buffer below the top of stack") {
  ProgramBuilder b;
  b.number(5.0f).number(7.0f);
  // Build the [nil, nil] buffer, then overwrite slot 0 (offset 1) and slot 1
  // (offset 0) per the calling-convention fill pattern.
  b.valueNil();
  b.beginFunction()
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::STACK_SET_REL, 1)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::STACK_SET_REL, 0)
      .instr(Op::SWAP)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  // The buffer held [5, 7]; SWAP exposes slot 0, so RET returns 5.
  CHECK(result.result.asNumber() == 5.0f);
  REQUIRE(machine.state.stackDepth == 1);
  CHECK(machine.state.stack[0].asNumber() == 5.0f);
}

TEST_CASE("STACK_SET_REL faults ScriptError when the offset passes the bottom") {
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::STACK_SET_REL, 5)
      .instr(Op::RET);
  // With an empty post-pop stack there is no slot to write at any offset.
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::STACK_SET_REL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine outOfRange;
  REQUIRE(startExecution(outOfRange.state, image, 0, {}).isOk());
  outOfRange.state.budget = 10;
  const RunResult farResult = runExecution(outOfRange.state, image);
  REQUIRE(farResult.status == RunStatus::Fault);
  CHECK(farResult.error == ErrorCode::ScriptError);
  CHECK(farResult.site.pc == 2);

  Machine empty;
  REQUIRE(startExecution(empty.state, image, 1, {}).isOk());
  empty.state.budget = 10;
  const RunResult emptyResult = runExecution(empty.state, image);
  REQUIRE(emptyResult.status == RunStatus::Fault);
  CHECK(emptyResult.error == ErrorCode::ScriptError);
  CHECK(emptyResult.site.pc == 1);
}

TEST_CASE("JMP applies signed relative offsets in both directions") {
  ProgramBuilder b;
  b.number(7.0f);
  // 0: JMP +3 -> 3: JMP -2 -> 1: push 7 -> 2: JMP +2 -> 4: RET.
  b.beginFunction()
      .instr(Op::JMP, 3)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::JMP, 2)
      .instr(Op::JMP, -2)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.asNumber() == 7.0f);
}

TEST_CASE("conditional jumps branch on the contract truthiness table") {
  // Each function pushes one constant and routes through JMP_IF_FALSE:
  // truthy continues to push 1, falsy jumps to push 0.
  ProgramBuilder b;
  b.poolString("").poolString("x");
  b.atomType(CoreTypeAtomId::Number);
  const float nan = std::numeric_limits<float>::quiet_NaN();
  b.valueNil().valueVoid().valueUnknown().valueBool(false).valueBool(true);
  b.valueNumber(0.0f).valueNumber(-0.0f).valueNumber(2.0f).valueNumber(nan);
  b.valueString(0).valueString(1).valueEnum(0, 0).valueFunction(0);
  b.number(1.0f).number(0.0f);
  const bool expected[13] = {false, false, false, false, true, false, false,
                             true,  true,  false, true,  true, true};
  for (uint32_t k = 0; k < 13; k++) {
    b.beginFunction()
        .instr(Op::PUSH_CONST_VAL, static_cast<int32_t>(k))
        .instr(Op::JMP_IF_FALSE, 3)
        .instr(Op::PUSH_CONST_NUM, 0)
        .instr(Op::RET)
        .instr(Op::PUSH_CONST_NUM, 1)
        .instr(Op::RET);
  }
  std::vector<uint8_t> storage(32 * 1024);
  const ProgramImage image = b.build(storage);

  for (uint32_t k = 0; k < 13; k++) {
    CAPTURE(k);
    Machine machine;
    REQUIRE(startExecution(machine.state, image, k, {}).isOk());
    machine.state.budget = 10;
    const RunResult result = runExecution(machine.state, image);
    REQUIRE(result.status == RunStatus::Done);
    CHECK(result.result.asNumber() == (expected[k] ? 1.0f : 0.0f));
  }
}

TEST_CASE("JMP_IF_TRUE is the symmetric truthy branch") {
  ProgramBuilder b;
  b.valueBool(true).valueBool(false);
  b.number(1.0f).number(0.0f);
  for (uint32_t k = 0; k < 2; k++) {
    b.beginFunction()
        .instr(Op::PUSH_CONST_VAL, static_cast<int32_t>(k))
        .instr(Op::JMP_IF_TRUE, 3)
        .instr(Op::PUSH_CONST_NUM, 1)
        .instr(Op::RET)
        .instr(Op::PUSH_CONST_NUM, 0)
        .instr(Op::RET);
  }
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  for (uint32_t k = 0; k < 2; k++) {
    CAPTURE(k);
    Machine machine;
    REQUIRE(startExecution(machine.state, image, k, {}).isOk());
    machine.state.budget = 10;
    const RunResult result = runExecution(machine.state, image);
    REQUIRE(result.status == RunStatus::Done);
    // Function 0 pushes true and takes the jump to the marker 1; function 1
    // pushes false and falls through to the marker 0.
    CHECK(result.result.asNumber() == (k == 0 ? 1.0f : 0.0f));
  }
}

TEST_CASE("isTruthy covers the VM-internal value kinds directly") {
  ProgramBuilder b;
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  CHECK(isTruthy(Value::handle(3), image));
  CHECK(!isTruthy(Value::error(ErrorCode::ScriptError), image));
  CHECK(!isTruthy(kNilValue, image));
  CHECK(isTruthy(kTrueValue, image));
  CHECK(!isTruthy(kFalseValue, image));
}

TEST_CASE("WHEN/DO boundaries gate the DO section on the WHEN result") {
  // Mirrors the compiled rule shape: WHEN_START, condition, WHEN_END +4,
  // DO_START, body, RET; the falsy path lands past the DO section.
  ProgramBuilder b;
  b.valueBool(true).valueBool(false).valueNil();
  b.number(42.0f);
  for (uint32_t k = 0; k < 2; k++) {
    b.beginFunction()
        .instr(Op::WHEN_START)
        .instr(Op::PUSH_CONST_VAL, static_cast<int32_t>(k))
        .instr(Op::WHEN_END, 4)
        .instr(Op::DO_START)
        .instr(Op::PUSH_CONST_NUM, 0)
        .instr(Op::RET)
        .instr(Op::PUSH_CONST_VAL, 2)
        .instr(Op::RET);
  }
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine truthy;
  REQUIRE(startExecution(truthy.state, image, 0, {}).isOk());
  truthy.state.budget = 10;
  const RunResult ranDo = runExecution(truthy.state, image);
  REQUIRE(ranDo.status == RunStatus::Done);
  CHECK(ranDo.result.asNumber() == 42.0f);

  Machine falsy;
  REQUIRE(startExecution(falsy.state, image, 1, {}).isOk());
  falsy.state.budget = 10;
  const RunResult skippedDo = runExecution(falsy.state, image);
  REQUIRE(skippedDo.status == RunStatus::Done);
  CHECK(skippedDo.result.tag() == ValueTag::Nil);
}

TEST_CASE("DO_END is a pure marker") {
  ProgramBuilder b;
  b.number(3.0f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::DO_END).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.asNumber() == 3.0f);
}

TEST_CASE("locals are seeded from args, nil-filled, and frame-indexed") {
  ProgramBuilder b;
  // params 2 + 1 extra local: copy arg 1 into the extra slot and return it.
  b.beginFunction(2, 1)
      .instr(Op::LOAD_LOCAL, 1)
      .instr(Op::STORE_LOCAL, 2)
      .instr(Op::LOAD_LOCAL, 2)
      .instr(Op::RET);
  // The extra local reads nil before any store.
  b.beginFunction(0, 1).instr(Op::LOAD_LOCAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const Value args[3] = {Value::number(10.0f), Value::number(20.0f), Value::number(30.0f)};
  // Excess args beyond numLocals are dropped.
  REQUIRE(startExecution(machine.state, image, 0, Span<const Value>(args, 3)).isOk());
  CHECK(machine.state.localsDepth == 3);
  machine.state.budget = 10;
  const RunResult result = runExecution(machine.state, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.asNumber() == 20.0f);
  CHECK(machine.state.localsDepth == 0);

  Machine nilLocal;
  REQUIRE(startExecution(nilLocal.state, image, 1, {}).isOk());
  nilLocal.state.budget = 10;
  const RunResult nilResult = runExecution(nilLocal.state, image);
  REQUIRE(nilResult.status == RunStatus::Done);
  CHECK(nilResult.result.tag() == ValueTag::Nil);
}

TEST_CASE("LOAD_LOCAL and STORE_LOCAL fault ScriptError out of range") {
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction(0, 1).instr(Op::LOAD_LOCAL, 1).instr(Op::RET);
  b.beginFunction(0, 1).instr(Op::PUSH_CONST_NUM, 0).instr(Op::STORE_LOCAL, 1).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine load;
  REQUIRE(startExecution(load.state, image, 0, {}).isOk());
  load.state.budget = 10;
  const RunResult loadResult = runExecution(load.state, image);
  REQUIRE(loadResult.status == RunStatus::Fault);
  CHECK(loadResult.error == ErrorCode::ScriptError);

  Machine store;
  REQUIRE(startExecution(store.state, image, 1, {}).isOk());
  store.state.budget = 10;
  const RunResult storeResult = runExecution(store.state, image);
  REQUIRE(storeResult.status == RunStatus::Fault);
  CHECK(storeResult.error == ErrorCode::ScriptError);
  CHECK(storeResult.site.pc == 1);
  // The bounds check precedes the pop, so the operand is still on the stack.
  CHECK(store.state.stackDepth == 1);
}

TEST_CASE("RET returns to the caller frame, cleaning stack and locals") {
  ProgramBuilder b;
  b.number(1.0f).number(2.0f).number(3.0f);
  // The "caller" body: a lone RET consuming the callee's pushed result.
  b.beginFunction(0, 1).instr(Op::RET);
  // The "callee" leaks two extra values below its return value.
  b.beginFunction(0, 2)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::PUSH_CONST_NUM, 2)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  REQUIRE(startExecution(machine.state, image, 0, {}).isOk());
  // Seed two caller operands so the callee's base sits above them, then
  // enter the callee as a call in progress (the caller pc already advanced).
  machine.state.stack[0] = Value::number(-1.0f);
  machine.state.stack[1] = Value::number(-2.0f);
  machine.state.stackDepth = 2;
  REQUIRE(startExecution(machine.state, image, 1, {}).isOk());
  CHECK(machine.state.frameDepth == 2);
  CHECK(machine.state.frames[1].base == 2);
  CHECK(machine.state.localsDepth == 3);

  machine.state.budget = 10;
  const RunResult result = runExecution(machine.state, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.asNumber() == 3.0f);
  // The callee's leaked operands were truncated to its base before the
  // return value was pushed, and both frames released their locals.
  CHECK(machine.state.frameDepth == 0);
  CHECK(machine.state.stackDepth == 1);
  CHECK(machine.state.stack[0].asNumber() == 3.0f);
  CHECK(machine.state.localsDepth == 0);
}

TEST_CASE("budget exhaustion suspends at an instruction boundary and resumes") {
  ProgramBuilder b;
  b.number(1.0f).number(2.0f).number(3.0f);
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::POP)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::POP)
      .instr(Op::PUSH_CONST_NUM, 2)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  REQUIRE(startExecution(machine.state, image, 0, {}).isOk());
  machine.state.budget = 3;
  const RunResult slice = runExecution(machine.state, image);
  REQUIRE(slice.status == RunStatus::Yielded);
  CHECK(machine.state.budget == 0);
  CHECK(machine.state.frames[0].pc == 3);
  REQUIRE(machine.state.stackDepth == 1);
  CHECK(machine.state.stack[0].asNumber() == 2.0f);

  machine.state.budget = 100;
  const RunResult resumed = runExecution(machine.state, image);
  REQUIRE(resumed.status == RunStatus::Done);
  CHECK(resumed.result.asNumber() == 3.0f);
  CHECK(machine.state.budget == 97);
}

TEST_CASE("entering the loop without a positive budget is a host-contract fault") {
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  REQUIRE(startExecution(machine.state, image, 0, {}).isOk());
  machine.state.budget = 0;
  const RunResult guarded = runExecution(machine.state, image);
  REQUIRE(guarded.status == RunStatus::Fault);
  CHECK(guarded.error == ErrorCode::HostError);
  CHECK(guarded.site.funcId == kNoFuncId);
  // The state is untouched and still runnable.
  CHECK(machine.state.frames[0].pc == 0);
  CHECK(machine.state.stackDepth == 0);
  machine.state.budget = 10;
  const RunResult result = runExecution(machine.state, image);
  REQUIRE(result.status == RunStatus::Done);
  CHECK(result.result.asNumber() == 1.0f);
}

TEST_CASE("popping opcodes fault StackUnderflow on an empty stack") {
  const Op poppers[7] = {Op::POP,          Op::DUP,         Op::SWAP,    Op::STACK_SET_REL,
                         Op::JMP_IF_FALSE, Op::JMP_IF_TRUE, Op::WHEN_END};
  for (const Op op : poppers) {
    CAPTURE(static_cast<int>(op));
    ProgramBuilder b;
    b.beginFunction().instr(op, 1).instr(Op::RET);
    std::vector<uint8_t> storage(16 * 1024);
    const ProgramImage image = b.build(storage);

    Machine machine;
    const RunResult result = runProgram(machine, image);
    REQUIRE(result.status == RunStatus::Fault);
    CHECK(result.error == ErrorCode::StackUnderflow);
    CHECK(result.site.funcId == 0);
    CHECK(result.site.pc == 0);
  }
}

TEST_CASE("RET on an empty stack faults StackUnderflow") {
  ProgramBuilder b;
  b.beginFunction().instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::StackUnderflow);
}

TEST_CASE("SWAP with one value faults StackUnderflow") {
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction().instr(Op::PUSH_CONST_NUM, 0).instr(Op::SWAP).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::StackUnderflow);
  CHECK(result.site.pc == 1);
}

TEST_CASE("pushing past the operand-stack limit faults StackOverflow") {
  ProgramBuilder b;
  b.number(1.0f);
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine(2);
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::StackOverflow);
  CHECK(result.site.pc == 2);
  CHECK(machine.state.stackDepth == 2);
}

TEST_CASE("startExecution rejects bad funcIds and exhausted regions") {
  ProgramBuilder b;
  b.beginFunction(0, 4).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const Status badFunc = startExecution(machine.state, image, 9, {});
  REQUIRE(!badFunc.isOk());
  CHECK(badFunc.error() == ErrorCode::HostError);

  Machine noLocals(kMaxStackSize, 2);
  const Status localsFull = startExecution(noLocals.state, image, 0, {});
  REQUIRE(!localsFull.isOk());
  CHECK(localsFull.error() == ErrorCode::StackOverflow);

  Machine noFrames(kMaxStackSize, kMaxLocalsSize, 1);
  REQUIRE(startExecution(noFrames.state, image, 0, {}).isOk());
  const Status framesFull = startExecution(noFrames.state, image, 0, {});
  REQUIRE(!framesFull.isOk());
  CHECK(framesFull.error() == ErrorCode::StackOverflow);
}

TEST_CASE("a jump landing outside the function faults ScriptError at the bad pc") {
  ProgramBuilder b;
  b.beginFunction().instr(Op::JMP, 5).instr(Op::RET);
  b.beginFunction().instr(Op::JMP, -1).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine forward;
  REQUIRE(startExecution(forward.state, image, 0, {}).isOk());
  forward.state.budget = 10;
  const RunResult pastEnd = runExecution(forward.state, image);
  REQUIRE(pastEnd.status == RunStatus::Fault);
  CHECK(pastEnd.error == ErrorCode::ScriptError);
  CHECK(pastEnd.site.funcId == 0);
  CHECK(pastEnd.site.pc == 5);

  // A negative pc wraps the unsigned counter and lands out of bounds.
  Machine backward;
  REQUIRE(startExecution(backward.state, image, 1, {}).isOk());
  backward.state.budget = 10;
  const RunResult beforeStart = runExecution(backward.state, image);
  REQUIRE(beforeStart.status == RunStatus::Fault);
  CHECK(beforeStart.error == ErrorCode::ScriptError);
}

TEST_CASE("running with no live frame faults ScriptError") {
  ProgramBuilder b;
  b.valueNil();
  b.beginFunction().instr(Op::PUSH_CONST_VAL, 0).instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine never;
  never.state.budget = 10;
  const RunResult unstarted = runExecution(never.state, image);
  REQUIRE(unstarted.status == RunStatus::Fault);
  CHECK(unstarted.error == ErrorCode::ScriptError);
  CHECK(unstarted.site.funcId == kNoFuncId);

  Machine machine;
  const RunResult completed = runProgram(machine, image);
  REQUIRE(completed.status == RunStatus::Done);
  machine.state.budget = 10;
  const RunResult reentered = runExecution(machine.state, image);
  REQUIRE(reentered.status == RunStatus::Fault);
  CHECK(reentered.error == ErrorCode::ScriptError);
}

TEST_CASE("every unimplemented opcode faults ScriptError deterministically") {
  for (const OpOperandSchema& row : kOperandSchema) {
    if (isImplementedOp(row.op)) {
      continue;
    }
    CAPTURE(static_cast<int>(row.op));
    ProgramBuilder b;
    b.beginFunction().instr(row.op).instr(Op::RET);
    std::vector<uint8_t> storage(16 * 1024);
    const ProgramImage image = b.build(storage);

    Machine machine;
    const RunResult result = runProgram(machine, image);
    REQUIRE(result.status == RunStatus::Fault);
    CHECK(result.error == ErrorCode::ScriptError);
    CHECK(result.site.funcId == 0);
    CHECK(result.site.pc == 0);
  }
}

TEST_CASE("a host-action call site faults ScriptError pending its dispatch path") {
  // The committed device fixture's call shape: two nil args, then
  // HOST_ACTION_CALL with the stable action id, argc, and callSiteId.
  ProgramBuilder b;
  b.valueNil();
  b.beginFunction()
      .instr(Op::WHEN_START)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::HOST_ACTION_CALL, 0x400, 2, 0)
      .instr(Op::WHEN_END, 2)
      .instr(Op::PUSH_CONST_VAL, 0)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  Machine machine;
  const RunResult result = runProgram(machine, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::ScriptError);
  CHECK(result.site.pc == 3);
  // The args stay where the fault left them; nothing was popped.
  CHECK(machine.state.stackDepth == 2);
}

TEST_CASE("an opcode value outside the declared set faults, never UB") {
  const Instr code[2] = {{static_cast<Op>(200), 0, 0, 0}, {Op::RET, 0, 0, 0}};
  const FunctionBytecode fn{0, 2, 0, 0, kNoTypeIdx};
  ProgramImage image{};
  image.functions = Span<const FunctionBytecode>(&fn, 1);
  image.instructions = Span<const Instr>(code, 2);

  Machine machine;
  REQUIRE(startExecution(machine.state, image, 0, {}).isOk());
  machine.state.budget = 10;
  const RunResult result = runExecution(machine.state, image);
  REQUIRE(result.status == RunStatus::Fault);
  CHECK(result.error == ErrorCode::ScriptError);
  CHECK(result.site.pc == 0);
}

TEST_CASE("a suspended state's regions survive another state's run on the shared pool") {
  ProgramBuilder b;
  b.number(1.0f).number(2.0f).number(3.0f);
  b.beginFunction()
      .instr(Op::PUSH_CONST_NUM, 0)
      .instr(Op::PUSH_CONST_NUM, 1)
      .instr(Op::PUSH_CONST_NUM, 2)
      .instr(Op::SWAP)
      .instr(Op::POP)
      .instr(Op::RET);
  std::vector<uint8_t> storage(16 * 1024);
  const ProgramImage image = b.build(storage);

  std::array<Value, 32> valueStorage;
  std::array<Frame, 8> frameStorage;
  StackRegionPool<Value> valuePool(Span<Value>(valueStorage.data(), valueStorage.size()));
  StackRegionPool<Frame> framePool(Span<Frame>(frameStorage.data(), frameStorage.size()));

  const auto bindState = [&](uint32_t stackSlots, uint32_t localSlots, uint32_t frameSlots) {
    ExecutionState state{};
    state.stack = valuePool.acquire(stackSlots);
    state.stackLimit = stackSlots;
    state.locals = valuePool.acquire(localSlots);
    state.localsLimit = localSlots;
    state.frames = framePool.acquire(frameSlots);
    state.frameLimit = frameSlots;
    REQUIRE(state.stack != nullptr);
    REQUIRE(state.locals != nullptr);
    REQUIRE(state.frames != nullptr);
    return state;
  };

  // Suspend the first state two instructions in.
  ExecutionState suspended = bindState(8, 4, 2);
  REQUIRE(startExecution(suspended, image, 0, {}).isOk());
  suspended.budget = 2;
  REQUIRE(runExecution(suspended, image).status == RunStatus::Yielded);

  // New work binds above the suspended high-water and runs to completion.
  ExecutionState transient = bindState(8, 4, 2);
  REQUIRE(startExecution(transient, image, 0, {}).isOk());
  transient.budget = 100;
  const RunResult transientResult = runExecution(transient, image);
  REQUIRE(transientResult.status == RunStatus::Done);
  CHECK(transientResult.result.asNumber() == 3.0f);
  valuePool.releaseTo(transient.stack);
  framePool.releaseTo(transient.frames);

  // The suspended state's live range was preserved; it resumes and finishes.
  CHECK(suspended.stack[0].asNumber() == 1.0f);
  CHECK(suspended.stack[1].asNumber() == 2.0f);
  suspended.budget = 100;
  const RunResult resumed = runExecution(suspended, image);
  REQUIRE(resumed.status == RunStatus::Done);
  CHECK(resumed.result.asNumber() == 3.0f);
}
