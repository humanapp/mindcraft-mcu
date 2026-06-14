#include "core/runtime/vm.h"

#include "core/runtime/managed-heap.h"

namespace mindcraft {

namespace {

/**
 * Floors a brain number to an integer container index. Returns false for
 * non-finite values or magnitudes outside the int32 range; callers treat a
 * false result as an out-of-range index. Container sizes are bounded by the
 * region, far inside int32, so a value outside that range is always out of
 * bounds.
 */
bool numberToIndex(mc_number_t value, int32_t& out) {
  if (value != value) {
    return false; // NaN
  }
  // The bounds are exact powers of two in f32; `< 2^31` keeps the cast in range.
  if (!(value >= -2147483648.0f && value < 2147483648.0f)) {
    return false; // +/-inf or beyond int32
  }
  int32_t truncated = static_cast<int32_t>(value); // truncates toward zero
  if (static_cast<mc_number_t>(truncated) > value) {
    truncated -= 1; // floor toward negative infinity
  }
  out = truncated;
  return true;
}

/**
 * Converts a popped map-key value to a {@link MapKey}. Returns false when the
 * value is neither a number nor a string, mirroring the TS key-kind fault.
 */
bool valueToMapKey(const Value& value, MapKey& out) {
  if (value.isNumber()) {
    out = MapKey{true, value.asNumber(), 0};
    return true;
  }
  if (value.isString()) {
    out = MapKey{false, 0.0f, value.borrowedStringIndex()};
    return true;
  }
  return false;
}

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
 * Convert a decoded constant-pool entry to a runtime value. Returns false for
 * the `List`, `Map`, and `Struct` constant kinds and for a `Function` constant
 * carrying captures; the caller faults on a false result.
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

bool isTruthy(const Value& value, const ProgramImage& program, const ManagedHeap* heap) {
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
    // A list is truthy when non-empty. Reachable only with a configured heap.
    return heap != nullptr && heap->list(value)->size > 0;
  case ValueTag::Map:
    // A map is truthy when non-empty. Reachable only with a configured heap.
    return heap != nullptr && heap->map(value)->size > 0;
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
      frame.pc = isTruthy(value, program, surface.heap) ? frame.pc + 1 : addRel(frame.pc, ins.a);
      break;
    }

    case Op::JMP_IF_TRUE: {
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      frame.pc = isTruthy(value, program, surface.heap) ? addRel(frame.pc, ins.a) : frame.pc + 1;
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
      if (surface.context == nullptr || ins.a >= surface.context->variables.size()) {
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
      if (surface.context == nullptr || ins.a >= surface.context->variables.size()) {
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
      if (surface.context == nullptr || ins.c >= surface.context->callSiteStates.size()) {
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
      frame.pc = isTruthy(value, program, surface.heap) ? frame.pc + 1 : addRel(frame.pc, ins.a);
      break;
    }

    case Op::LIST_NEW: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value listValue;
      if (!surface.heap->newList(ins.b, surface.roots, listValue)) {
        return fault(ErrorCode::StackOverflow);
      }
      if (!pushValue(state, listValue)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::LIST_PUSH: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      // [list, item] -> [list]. Both operands stay on the stack (rooted)
      // across the possible backing growth and collection.
      if (state.stackDepth < 2) {
        return fault(ErrorCode::StackUnderflow);
      }
      const Value& listSlot = state.stack[state.stackDepth - 2];
      const Value& itemSlot = state.stack[state.stackDepth - 1];
      if (!listSlot.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!surface.heap->listPush(surface.heap->list(listSlot), itemSlot, surface.roots)) {
        return fault(ErrorCode::StackOverflow);
      }
      state.stackDepth--; // drop the item, leaving the list on top
      frame.pc++;
      break;
    }

    case Op::LIST_GET: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value index;
      Value listValue;
      if (!popValue(state, index) || !popValue(state, listValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!listValue.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!index.isNumber()) {
        return fault(ErrorCode::ScriptError);
      }
      int32_t idx = 0;
      Value result = kNilValue;
      if (numberToIndex(index.asNumber(), idx)) {
        result = surface.heap->listGet(surface.heap->list(listValue), idx);
      }
      if (!pushValue(state, result)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::LIST_SET: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      // [list, index, value] -> [list]. An in-place overwrite never allocates.
      if (state.stackDepth < 3) {
        return fault(ErrorCode::StackUnderflow);
      }
      const Value& listSlot = state.stack[state.stackDepth - 3];
      const Value& indexSlot = state.stack[state.stackDepth - 2];
      const Value& valueSlot = state.stack[state.stackDepth - 1];
      if (!listSlot.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!indexSlot.isNumber()) {
        return fault(ErrorCode::ScriptError);
      }
      int32_t idx = 0;
      if (numberToIndex(indexSlot.asNumber(), idx)) {
        surface.heap->listSet(surface.heap->list(listSlot), idx, valueSlot);
      }
      state.stackDepth -= 2; // drop index and value, leaving the list on top
      frame.pc++;
      break;
    }

    case Op::LIST_LEN: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value listValue;
      if (!popValue(state, listValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!listValue.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      const Value len =
          Value::number(static_cast<mc_number_t>(surface.heap->list(listValue)->size));
      if (!pushValue(state, len)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::LIST_POP: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value listValue;
      if (!popValue(state, listValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!listValue.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, surface.heap->listPop(surface.heap->list(listValue)))) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::LIST_SHIFT: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value listValue;
      if (!popValue(state, listValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!listValue.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, surface.heap->listShift(surface.heap->list(listValue)))) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::LIST_REMOVE: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value index;
      Value listValue;
      if (!popValue(state, index) || !popValue(state, listValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!listValue.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!index.isNumber()) {
        return fault(ErrorCode::ScriptError);
      }
      int32_t idx = 0;
      Value result = kNilValue;
      if (numberToIndex(index.asNumber(), idx)) {
        result = surface.heap->listRemove(surface.heap->list(listValue), idx);
      }
      if (!pushValue(state, result)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::LIST_INSERT: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      // [list, index, value] -> []; operands stay rooted across a grow.
      if (state.stackDepth < 3) {
        return fault(ErrorCode::StackUnderflow);
      }
      const Value& listSlot = state.stack[state.stackDepth - 3];
      const Value& indexSlot = state.stack[state.stackDepth - 2];
      const Value& valueSlot = state.stack[state.stackDepth - 1];
      if (!listSlot.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!indexSlot.isNumber()) {
        return fault(ErrorCode::ScriptError);
      }
      int32_t idx = 0;
      if (numberToIndex(indexSlot.asNumber(), idx)) {
        if (!surface.heap->listInsert(surface.heap->list(listSlot), idx, valueSlot,
                                      surface.roots)) {
          return fault(ErrorCode::StackOverflow);
        }
      }
      state.stackDepth -= 3;
      frame.pc++;
      break;
    }

    case Op::LIST_SWAP: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      // [list, i, j] -> []. An in-place swap never allocates.
      if (state.stackDepth < 3) {
        return fault(ErrorCode::StackUnderflow);
      }
      const Value& listSlot = state.stack[state.stackDepth - 3];
      const Value& iSlot = state.stack[state.stackDepth - 2];
      const Value& jSlot = state.stack[state.stackDepth - 1];
      if (!listSlot.isList()) {
        return fault(ErrorCode::ScriptError);
      }
      if (!iSlot.isNumber() || !jSlot.isNumber()) {
        return fault(ErrorCode::ScriptError);
      }
      int32_t i = 0;
      int32_t j = 0;
      if (numberToIndex(iSlot.asNumber(), i) && numberToIndex(jSlot.asNumber(), j)) {
        surface.heap->listSwap(surface.heap->list(listSlot), i, j);
      }
      state.stackDepth -= 3;
      frame.pc++;
      break;
    }

    case Op::MAP_NEW: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value mapValue;
      if (!surface.heap->newMap(ins.b, surface.roots, mapValue)) {
        return fault(ErrorCode::StackOverflow);
      }
      if (!pushValue(state, mapValue)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::MAP_SET: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      // [map, key, value] -> [map]; operands stay rooted across a grow.
      if (state.stackDepth < 3) {
        return fault(ErrorCode::StackUnderflow);
      }
      const Value& mapSlot = state.stack[state.stackDepth - 3];
      const Value& keySlot = state.stack[state.stackDepth - 2];
      const Value& valueSlot = state.stack[state.stackDepth - 1];
      if (!mapSlot.isMap()) {
        return fault(ErrorCode::ScriptError);
      }
      MapKey key;
      if (!valueToMapKey(keySlot, key)) {
        return fault(ErrorCode::ScriptError);
      }
      if (!surface.heap->mapSet(surface.heap->map(mapSlot), key, valueSlot, surface.roots)) {
        return fault(ErrorCode::StackOverflow);
      }
      state.stackDepth -= 2; // drop key and value, leaving the map on top
      frame.pc++;
      break;
    }

    case Op::MAP_GET: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value key;
      Value mapValue;
      if (!popValue(state, key) || !popValue(state, mapValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!mapValue.isMap()) {
        return fault(ErrorCode::ScriptError);
      }
      MapKey mapKey;
      if (!valueToMapKey(key, mapKey)) {
        return fault(ErrorCode::ScriptError);
      }
      if (!pushValue(state, surface.heap->mapGet(surface.heap->map(mapValue), mapKey))) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::MAP_HAS: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value key;
      Value mapValue;
      if (!popValue(state, key) || !popValue(state, mapValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!mapValue.isMap()) {
        return fault(ErrorCode::ScriptError);
      }
      MapKey mapKey;
      if (!valueToMapKey(key, mapKey)) {
        return fault(ErrorCode::ScriptError);
      }
      const Value has = Value::boolean(surface.heap->mapHas(surface.heap->map(mapValue), mapKey));
      if (!pushValue(state, has)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::MAP_DELETE: {
      if (surface.heap == nullptr) {
        return fault(ErrorCode::HostError);
      }
      Value key;
      Value mapValue;
      if (!popValue(state, key) || !popValue(state, mapValue)) {
        return fault(ErrorCode::StackUnderflow);
      }
      if (!mapValue.isMap()) {
        return fault(ErrorCode::ScriptError);
      }
      MapKey mapKey;
      if (!valueToMapKey(key, mapKey)) {
        return fault(ErrorCode::ScriptError);
      }
      surface.heap->mapDelete(surface.heap->map(mapValue), mapKey);
      if (!pushValue(state, mapValue)) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
      break;
    }

    case Op::TYPE_CHECK: {
      Value value;
      if (!popValue(state, value)) {
        return fault(ErrorCode::StackUnderflow);
      }
      const bool match = static_cast<int32_t>(value.tag()) == static_cast<int32_t>(ins.a);
      if (!pushValue(state, Value::boolean(match))) {
        return fault(ErrorCode::StackOverflow);
      }
      frame.pc++;
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
