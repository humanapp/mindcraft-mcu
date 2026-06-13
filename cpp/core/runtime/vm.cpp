#include "core/runtime/vm.h"

namespace mindcraft {

namespace {

/** Push `value`; false when the operand stack is at capacity. */
bool pushValue(ExecutionState& state, const Value& value) {
  if (state.stackDepth >= state.stackLimit) {
    return false;
  }
  state.stack[state.stackDepth++] = value;
  return true;
}

/** Pop the top of stack into `out`; false when the operand stack is empty. */
bool popValue(ExecutionState& state, Value& out) {
  if (state.stackDepth == 0) {
    return false;
  }
  out = state.stack[--state.stackDepth];
  return true;
}

/** Apply a signed relative offset (two's-complement bit pattern) to a pc. */
uint32_t addRel(uint32_t pc, uint32_t relBits) {
  return static_cast<uint32_t>(static_cast<int32_t>(pc) + static_cast<int32_t>(relBits));
}

/**
 * Convert a decoded constant-pool entry to a runtime value. False for the
 * kinds whose runtime representation needs the managed heap (containers and
 * capture lists), which is not implemented yet.
 */
bool constValueToRuntime(const ConstValue& constant, Value& out) {
  switch (constant.kind) {
  case ConstValueKind::Unknown:
    out = kUnknownValue;
    return true;
  case ConstValueKind::Void:
    out = kVoidValue;
    return true;
  case ConstValueKind::Nil:
    out = kNilValue;
    return true;
  case ConstValueKind::Boolean:
    out = Value::boolean(constant.boolean.value);
    return true;
  case ConstValueKind::Number:
    out = Value::number(constant.number.value);
    return true;
  case ConstValueKind::String:
    out = Value::borrowedString(constant.string.stringIdx);
    return true;
  case ConstValueKind::Enum:
    out = Value::enumSymbol(constant.enumVal.typeIdx, constant.enumVal.ordinal);
    return true;
  case ConstValueKind::Function:
    if (constant.function.hasCaptures) {
      return false;
    }
    out = Value::function(constant.function.funcId);
    return true;
  case ConstValueKind::List:
  case ConstValueKind::Map:
  case ConstValueKind::Struct:
    return false;
  }
  return false;
}

} // namespace

bool isTruthy(const Value& value, const ProgramImage& program) {
  switch (value.tag()) {
  case ValueTag::Unknown:
  case ValueTag::Void:
  case ValueTag::Nil:
    return false;
  case ValueTag::Boolean:
    return value.asBoolean();
  case ValueTag::Number:
    // NaN compares unequal to zero, so NaN numbers are truthy, matching the
    // TS reference rule (`v !== 0`).
    return value.asNumber() != 0.0f;
  case ValueTag::String: {
    const uint32_t index = value.borrowedStringIndex();
    return index < program.strings.size() && program.strings[index].length > 0;
  }
  case ValueTag::Enum:
  case ValueTag::Struct:
  case ValueTag::Function:
  case ValueTag::Handle:
    return true;
  case ValueTag::List:
  case ValueTag::Map:
    // Containers are truthy when non-empty. No opcode can construct one until
    // the heap backings land, so this arm is unreachable from live values.
    return true;
  case ValueTag::Err:
    return false;
  }
  return false;
}

Status startExecution(ExecutionState& state, const ProgramImage& program, uint32_t funcId,
                      Span<const Value> args) {
  if (funcId >= program.functions.size()) {
    return Status::fail(ErrorCode::HostError);
  }
  const FunctionBytecode& fn = program.functions[funcId];
  if (state.frameDepth >= state.frameLimit) {
    return Status::fail(ErrorCode::StackOverflow);
  }
  if (fn.numLocals > state.localsLimit - state.localsDepth) {
    return Status::fail(ErrorCode::StackOverflow);
  }

  const uint32_t localsOffset = state.localsDepth;
  for (uint32_t i = 0; i < fn.numLocals; i++) {
    state.locals[localsOffset + i] = i < args.size() ? args[i] : kNilValue;
  }
  state.localsDepth += fn.numLocals;

  Frame& frame = state.frames[state.frameDepth++];
  frame.funcId = funcId;
  frame.pc = 0;
  frame.base = state.stackDepth;
  frame.localsOffset = localsOffset;
  frame.localsCount = fn.numLocals;
  frame.captures = kNoCaptures;
  frame.ruleFuncId = kNoFuncId;
  frame.hasActionBinding = false;
  frame.actionBinding = ActionFrameBinding{0, 0, false};
  return Status::ok();
}

RunResult runExecution(ExecutionState& state, const ProgramImage& program,
                       const RuntimeSurface& surface) {
  if (state.budget <= 0) {
    // Host-contract violation: a slice must be entered with a positive
    // budget. The state is untouched and stays resumable.
    return RunResult::fault(ErrorCode::HostError, kNoFuncId, 0);
  }

  while (state.budget > 0) {
    state.budget--;

    if (state.frameDepth == 0) {
      return RunResult::fault(ErrorCode::ScriptError, kNoFuncId, 0);
    }
    Frame& frame = state.frames[state.frameDepth - 1];
    const auto fault = [&frame](ErrorCode code) {
      return RunResult::fault(code, frame.funcId, frame.pc);
    };

    if (frame.funcId >= program.functions.size()) {
      return fault(ErrorCode::ScriptError);
    }
    const FunctionBytecode& fn = program.functions[frame.funcId];
    if (frame.pc >= fn.codeCount) {
      return fault(ErrorCode::ScriptError);
    }
    const Instr& ins = program.instructions[fn.codeOffset + frame.pc];

    switch (ins.op) {
    case Op::PUSH_CONST_VAL: {
      if (ins.a >= program.constantPools.valueCount) {
        return fault(ErrorCode::ScriptError);
      }
      Value value;
      if (!constValueToRuntime(program.constValues[ins.a], value)) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, value)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::PUSH_CONST_NUM: {
      if (ins.a >= program.constantPools.numberCount) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, Value::number(program.constNumbers[ins.a]))) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::PUSH_CONST_STR: {
      if (ins.a >= program.constantPools.stringCount) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, Value::borrowedString(ins.a))) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::POP: {
      Value discarded;
      if (!popValue(state, discarded)) {
        return fault(ErrorCode::StackUnderflow);
      }
      frame.pc++;
      break;
    }

    case Op::DUP: {
      if (state.stackDepth == 0) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!pushValue(state, state.stack[state.stackDepth - 1])) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::SWAP: {
      Value a;
      Value b;
      if (!popValue(state, a) || !popValue(state, b)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!pushValue(state, a) || !pushValue(state, b)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::STACK_SET_REL: {
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      // `a` addresses the post-pop stack relative to its top; an offset past
      // the bottom is an out-of-bounds write.
      if (ins.a >= state.stackDepth) {
        return fault(ErrorCode::ScriptError);
      }
      state.stack[state.stackDepth - 1 - ins.a] = value;
      frame.pc++;
      break;
    }

    case Op::JMP: {
      frame.pc = addRel(frame.pc, ins.a);
      break;
    }

    case Op::JMP_IF_FALSE: {
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      frame.pc = isTruthy(value, program) ? frame.pc + 1 : addRel(frame.pc, ins.a);
      break;
    }

    case Op::JMP_IF_TRUE: {
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      frame.pc = isTruthy(value, program) ? addRel(frame.pc, ins.a) : frame.pc + 1;
      break;
    }

    case Op::RET: {
      Value retv;
      if (!popValue(state, retv)) {
        return fault(ErrorCode::StackUnderflow);
      }
      const Frame returning = frame;
      state.frameDepth--;
      if (state.stackDepth > returning.base) {
        state.stackDepth = returning.base;
      }
      state.localsDepth = returning.localsOffset;
      if (!pushValue(state, retv)) {
        return RunResult::fault(ErrorCode::StackOverflow, returning.funcId, returning.pc);
      }
      if (state.frameDepth == 0) {
        return RunResult::done(retv);
      }
      // The caller's pc was advanced when the call was made; execution
      // continues at its next instruction.
      break;
    }

    case Op::LOAD_LOCAL: {
      if (ins.a >= frame.localsCount) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, state.locals[frame.localsOffset + ins.a])) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::STORE_LOCAL: {
      if (ins.a >= frame.localsCount) {
        return fault(ErrorCode::ScriptError);
      }
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      state.locals[frame.localsOffset + ins.a] = value;
      frame.pc++;
      break;
    }

    case Op::LOAD_VAR_SLOT: {
      if (ins.a >= program.variableNames.size()) {
        return fault(ErrorCode::ScriptError);
      }
      if (surface.context == nullptr || ins.a >= kMaxBrainVariables) {
        return fault(ErrorCode::HostError);
      }
      if (!pushValue(state, surface.context->variables[ins.a])) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::STORE_VAR_SLOT: {
      if (ins.a >= program.variableNames.size()) {
        return fault(ErrorCode::ScriptError);
      }
      if (surface.context == nullptr || ins.a >= kMaxBrainVariables) {
        return fault(ErrorCode::HostError);
      }
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      surface.context->variables[ins.a] = value;
      frame.pc++;
      break;
    }

    case Op::HOST_ACTION_CALL: {
      const uint32_t argc = ins.b;
      if (argc > state.stackDepth) {
        return fault(ErrorCode::StackUnderflow);
      }
      const HostActionBinding* action = findHostActionById(surface.actions, ins.a);
      if (action == nullptr || action->execSync == nullptr) {
        // Existence check: no registration holds the id (or it has no sync
        // body), mirroring the TS resolveHostAction fault.
        return fault(ErrorCode::ScriptError);
      }
      if (surface.context == nullptr || ins.c >= kMaxCallSiteStates) {
        return fault(ErrorCode::HostError);
      }
      ExecutionContext& ctx = *surface.context;
      ctx.currentCallSiteId = ins.c;
      const Span<const Value> args(state.stack + (state.stackDepth - argc), argc);
      const Value result = action->execSync(action->hostData, ctx, args);
      if (surface.observer != nullptr) {
        surface.observer->onHostActionCall(ins.a, ins.c, args, result);
      }
      state.stackDepth -= argc;
      ctx.currentCallSiteId = kNoCallSiteId;
      if (!pushValue(state, result)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::WHEN_START:
    case Op::DO_START:
    case Op::DO_END: {
      // Pure section markers: advance the pc, no other effect.
      frame.pc++;
      break;
    }

    case Op::WHEN_END: {
      // The WHEN section leaves exactly one value: truthy falls through into
      // the DO section, falsy jumps past it by the signed `a` offset.
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      frame.pc = isTruthy(value, program) ? frame.pc + 1 : addRel(frame.pc, ins.a);
      break;
    }

    default:
      // Every opcode outside the implemented subset faults deterministically.
      return fault(ErrorCode::ScriptError);
    }
  }

  return RunResult::yielded();
}

} // namespace mindcraft
