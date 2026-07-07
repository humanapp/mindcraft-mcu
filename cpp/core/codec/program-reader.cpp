#include "core/codec/program-reader.h"

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "core/platform/byte-cursor.h"
#include "core/runtime/bytecode.h"
#include "core/runtime/core-type-atom-id.h"

namespace mindcraft {
namespace {

// Wire framing constants of the binary `.mcprogram` format; values mirror
// external/mindcraft-lang/packages/core/src/runtime/brain-program-binary-codec.ts.
constexpr uint8_t kMagic[4] = {0x89, 0x4d, 0x42, 0x50}; // 0x89 "MBP"

constexpr uint8_t kPresenceActs = 1;
constexpr uint8_t kPresenceRulf = 2;
constexpr uint8_t kPresenceRanc = 4;
constexpr uint8_t kPresenceSyst = 8;

constexpr uint8_t kNumberSmallInt = 0;
constexpr uint8_t kNumberF32 = 1;
constexpr uint8_t kNumberF64 = 2;

constexpr uint8_t kActionFlagInitializer = 1;
constexpr uint8_t kActionFlagActivation = 2;
constexpr uint8_t kActionFlagDeactivation = 4;

constexpr uint8_t kSystemFlagInit = 1;
constexpr uint8_t kSystemFlagThink = 2;

constexpr uint8_t kMaxTypeEntryTag = static_cast<uint8_t>(TypeTag::Enum);

// Value-kind byte of a TYPS enum entry: the shared primitive kind of every
// symbol value the entry carries.
constexpr uint8_t kEnumValueKindNumber = 0;
constexpr uint8_t kEnumValueKindString = 1;
constexpr uint8_t kMaxCallSiteBindingTag = static_cast<uint8_t>(CallSiteBinding::Bytecode);
constexpr uint8_t kMaxMapKeyTag = static_cast<uint8_t>(MapKeyKind::String);

// CVAL value tags are the TS NativeType codes (Unknown = -1 stored as 0xff).
constexpr uint8_t kValueTagUnknown = 0xff;
constexpr uint8_t kValueTagVoid = 0;
constexpr uint8_t kValueTagNil = 1;
constexpr uint8_t kValueTagBoolean = 2;
constexpr uint8_t kValueTagNumber = 3;
constexpr uint8_t kValueTagString = 4;
constexpr uint8_t kValueTagEnum = 5;
constexpr uint8_t kValueTagList = 6;
constexpr uint8_t kValueTagMap = 7;
constexpr uint8_t kValueTagStruct = 8;
constexpr uint8_t kValueTagFunction = 11;
constexpr uint8_t kValueTagBuffer = 12;

/** Success/failure outcome of one decode step. */
class [[nodiscard]] DecodeStatus {
public:
  static constexpr DecodeStatus ok() { return DecodeStatus(true, LoadError::Truncated); }
  static constexpr DecodeStatus fail(LoadError error) { return DecodeStatus(false, error); }

  constexpr bool isOk() const { return ok_; }
  constexpr LoadError error() const { return error_; }

private:
  constexpr DecodeStatus(bool ok, LoadError error) : ok_(ok), error_(error) {}

  bool ok_;
  LoadError error_;
};

// Binds the value of a Result-returning read, propagating its LoadError out
// of the enclosing DecodeStatus-returning function on failure.
#define MC_READ(var, expr)                                                                         \
  std::decay_t<decltype((expr).value())> var;                                                      \
  {                                                                                                \
    const auto mcReadResult = (expr);                                                              \
    if (!mcReadResult.isOk()) {                                                                    \
      return DecodeStatus::fail(mcReadResult.error());                                             \
    }                                                                                              \
    var = mcReadResult.value();                                                                    \
  }

// Propagates a failed decode step out of a DecodeStatus-returning function.
#define MC_CHECK(expr)                                                                             \
  {                                                                                                \
    const DecodeStatus mcCheckStatus = (expr);                                                     \
    if (!mcCheckStatus.isOk()) {                                                                   \
      return mcCheckStatus;                                                                        \
    }                                                                                              \
  }

/**
 * Rejects a leading entry count larger than the bytes left in the buffer.
 * Every wire entry consumes at least one byte, so such a count is always a
 * truncation; failing here also keeps pool sizes bounded by the buffer size.
 */
DecodeStatus checkCountFits(uint32_t count, const ByteCursor& cursor) {
  if (count > cursor.remaining()) {
    return DecodeStatus::fail(LoadError::Truncated);
  }
  return DecodeStatus::ok();
}

DecodeStatus checkStringIndex(uint32_t index, uint32_t stringTotal) {
  if (index >= stringTotal) {
    return DecodeStatus::fail(LoadError::InvalidValueTag);
  }
  return DecodeStatus::ok();
}

DecodeStatus readCstrSection(ByteCursor& cursor, RegionArena& arena, ByteSpan wire,
                             ProgramImage& image, uint32_t& stringTotal) {
  MC_READ(total, cursor.readVarUint());
  MC_CHECK(checkCountFits(total, cursor));
  MC_READ(constStringCount, cursor.readVarUint());
  if (constStringCount > total) {
    return DecodeStatus::fail(LoadError::InvalidValueTag);
  }
  StringRef* strings = arena.allocate<StringRef>(total);
  if (strings == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < total; i++) {
    MC_READ(byteLen, cursor.readVarUint());
    MC_READ(bytes, cursor.readBytes(byteLen));
    strings[i] = {static_cast<uint32_t>(bytes.data() - wire.data()), byteLen};
  }
  image.strings = {strings, total};
  image.constantPools.stringCount = constStringCount;
  stringTotal = total;
  return DecodeStatus::ok();
}

DecodeStatus readNumberEntry(ByteCursor& cursor, float& out);

bool isKnownTypeAtom(uint32_t atomId, const ProgramReaderOptions& options) {
  if (atomId < kCoreTypeAtomIdCount) {
    return true;
  }
  if (atomId >= SHARED_TYPE_ATOM_BASE) {
    return atomId - SHARED_TYPE_ATOM_BASE < options.sharedTypeAtomCount;
  }
  return atomId >= TARGET_TYPE_ATOM_BASE &&
         atomId - TARGET_TYPE_ATOM_BASE < options.targetTypeAtomCount;
}

/**
 * Decodes the TYPS entry list. With null `entries`/`refs` the call is a
 * measure pass: it validates every entry and reports the shared type-ref
 * pool size in `refCount`; a second call over the same bytes fills the
 * allocated arrays.
 */
DecodeStatus readTypsEntries(ByteCursor& cursor, uint32_t typeCount, uint32_t stringTotal,
                             const ProgramReaderOptions& options, TypeEntry* entries,
                             uint32_t* refs, uint32_t& refCount, StructFieldRef* structFields,
                             uint32_t& structFieldCount) {
  refCount = 0;
  structFieldCount = 0;
  for (uint32_t i = 0; i < typeCount; i++) {
    // Children precede their parent: a child reference at or beyond the
    // entry's own index is malformed.
    const auto readChild = [&cursor, i]() -> Result<uint32_t, LoadError> {
      const Result<uint32_t, LoadError> idx = cursor.readVarUint();
      if (idx.isOk() && idx.value() >= i) {
        return Result<uint32_t, LoadError>::fail(LoadError::TypeForwardReference);
      }
      return idx;
    };

    TypeEntry entry{};
    MC_READ(tag, cursor.readU8());
    if (tag > kMaxTypeEntryTag) {
      return DecodeStatus::fail(LoadError::InvalidTypeEntryTag);
    }
    entry.tag = static_cast<TypeTag>(tag);
    switch (entry.tag) {
    case TypeTag::Atom: {
      MC_READ(atomId, cursor.readVarUint());
      if (!isKnownTypeAtom(atomId, options)) {
        return DecodeStatus::fail(LoadError::UnknownTypeAtom);
      }
      entry.atom = {atomId};
      break;
    }
    case TypeTag::List: {
      MC_READ(elem, readChild());
      entry.list = {elem};
      break;
    }
    case TypeTag::Map: {
      MC_READ(key, readChild());
      MC_READ(value, readChild());
      entry.map = {key, value};
      break;
    }
    case TypeTag::Union: {
      MC_READ(memberCount, cursor.readVarUint());
      MC_CHECK(checkCountFits(memberCount, cursor));
      entry.unionOf = {refCount, memberCount};
      for (uint32_t j = 0; j < memberCount; j++) {
        MC_READ(member, readChild());
        if (refs != nullptr) {
          refs[refCount] = member;
        }
        refCount++;
      }
      break;
    }
    case TypeTag::Function: {
      MC_READ(paramCount, cursor.readVarUint());
      MC_CHECK(checkCountFits(paramCount, cursor));
      entry.function = {refCount, paramCount, 0};
      for (uint32_t j = 0; j < paramCount; j++) {
        MC_READ(param, readChild());
        if (refs != nullptr) {
          refs[refCount] = param;
        }
        refCount++;
      }
      MC_READ(result, readChild());
      entry.function.result = result;
      break;
    }
    case TypeTag::Nullable: {
      MC_READ(base, readChild());
      entry.nullable = {base};
      break;
    }
    case TypeTag::Struct: {
      MC_READ(nameIdx, cursor.readVarUint());
      MC_CHECK(checkStringIndex(nameIdx, stringTotal));
      MC_READ(slotCount, cursor.readVarUint());
      MC_READ(fieldCount, cursor.readVarUint());
      MC_CHECK(checkCountFits(fieldCount, cursor));
      entry.structOf = {nameIdx, slotCount, structFieldCount, fieldCount};
      for (uint32_t j = 0; j < fieldCount; j++) {
        MC_READ(fieldNameIdx, cursor.readVarUint());
        MC_CHECK(checkStringIndex(fieldNameIdx, stringTotal));
        MC_READ(fieldId, cursor.readVarUint());
        if (structFields != nullptr) {
          structFields[structFieldCount] = {fieldNameIdx, fieldId};
        }
        structFieldCount++;
      }
      break;
    }
    case TypeTag::Enum: {
      MC_READ(nameIdx, cursor.readVarUint());
      MC_CHECK(checkStringIndex(nameIdx, stringTotal));
      MC_READ(symbolCount, cursor.readVarUint());
      MC_CHECK(checkCountFits(symbolCount, cursor));
      // Symbol keys land in one typeRefs run, their values in a second run
      // immediately after it, both indexed by ordinal.
      entry.enumOf = {nameIdx, refCount, symbolCount, refCount + symbolCount, false};
      if (symbolCount > 0) {
        MC_READ(valueKind, cursor.readU8());
        if (valueKind != kEnumValueKindNumber && valueKind != kEnumValueKindString) {
          return DecodeStatus::fail(LoadError::InvalidEnumValueKind);
        }
        entry.enumOf.stringValued = valueKind == kEnumValueKindString;
        for (uint32_t j = 0; j < symbolCount; j++) {
          MC_READ(symbolIdx, cursor.readVarUint());
          MC_CHECK(checkStringIndex(symbolIdx, stringTotal));
          if (refs != nullptr) {
            refs[entry.enumOf.symbolsOffset + j] = symbolIdx;
          }
          if (entry.enumOf.stringValued) {
            MC_READ(valueIdx, cursor.readVarUint());
            MC_CHECK(checkStringIndex(valueIdx, stringTotal));
            if (refs != nullptr) {
              refs[entry.enumOf.valuesOffset + j] = valueIdx;
            }
          } else {
            float value = 0.0f;
            MC_CHECK(readNumberEntry(cursor, value));
            if (refs != nullptr) {
              uint32_t bits = 0;
              memcpy(&bits, &value, sizeof(bits));
              refs[entry.enumOf.valuesOffset + j] = bits;
            }
          }
        }
        refCount += 2 * symbolCount;
      }
      break;
    }
    }
    if (entries != nullptr) {
      entries[i] = entry;
    }
  }
  return DecodeStatus::ok();
}

DecodeStatus readTypsSection(ByteCursor& cursor, RegionArena& arena, uint32_t stringTotal,
                             const ProgramReaderOptions& options, ProgramImage& image) {
  MC_READ(typeCount, cursor.readVarUint());
  MC_CHECK(checkCountFits(typeCount, cursor));
  ByteCursor measure = cursor;
  uint32_t refCount = 0;
  uint32_t structFieldCount = 0;
  MC_CHECK(readTypsEntries(measure, typeCount, stringTotal, options, nullptr, nullptr, refCount,
                           nullptr, structFieldCount));
  TypeEntry* entries = arena.allocate<TypeEntry>(typeCount);
  uint32_t* refs = arena.allocate<uint32_t>(refCount);
  StructFieldRef* structFields = arena.allocate<StructFieldRef>(structFieldCount);
  if (entries == nullptr || refs == nullptr || structFields == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  uint32_t filledRefCount = 0;
  uint32_t filledStructFieldCount = 0;
  MC_CHECK(readTypsEntries(cursor, typeCount, stringTotal, options, entries, refs, filledRefCount,
                           structFields, filledStructFieldCount));
  image.types = {entries, typeCount};
  image.typeRefs = {refs, refCount};
  image.structFields = {structFields, structFieldCount};
  return DecodeStatus::ok();
}

/** Decodes one CNUM-encoded number at the f32 device precision. */
DecodeStatus readNumberEntry(ByteCursor& cursor, float& out) {
  MC_READ(discriminant, cursor.readU8());
  if (discriminant == kNumberSmallInt) {
    MC_READ(value, cursor.readVarInt());
    out = static_cast<float>(value);
    return DecodeStatus::ok();
  }
  if (discriminant == kNumberF32) {
    MC_READ(value, cursor.readF32());
    out = value;
    return DecodeStatus::ok();
  }
  if (discriminant == kNumberF64) {
    return DecodeStatus::fail(LoadError::F64OnF32Target);
  }
  return DecodeStatus::fail(LoadError::InvalidNumberDiscriminant);
}

DecodeStatus readCnumSection(ByteCursor& cursor, RegionArena& arena, ProgramImage& image) {
  MC_READ(count, cursor.readVarUint());
  MC_CHECK(checkCountFits(count, cursor));
  float* numbers = arena.allocate<float>(count);
  if (numbers == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < count; i++) {
    MC_CHECK(readNumberEntry(cursor, numbers[i]));
  }
  image.constNumbers = {numbers, count};
  image.constantPools.numberCount = count;
  return DecodeStatus::ok();
}

/**
 * Slot bookkeeping for the CVAL decode. With null pools the pass only
 * measures: `valueCount`/`mapEntryCount` advance exactly as in the fill
 * pass, so a measure pass reports the pool sizes the fill pass writes.
 */
struct ValueDecodeState {
  ConstValue* values;
  ConstMapEntry* mapEntries;
  uint32_t valueCount;
  uint32_t mapEntryCount;
};

DecodeStatus checkTypeIndex(uint32_t typeIdx, const ProgramImage& image) {
  if (typeIdx >= image.types.size()) {
    return DecodeStatus::fail(LoadError::TypeIndexOutOfRange);
  }
  return DecodeStatus::ok();
}

/**
 * Decodes one recursive CVAL value node into slot `slot`. A container
 * reserves a contiguous run of child slots after every slot reserved so far,
 * then decodes each child into its run position.
 */
DecodeStatus readValueNode(ByteCursor& cursor, const ProgramImage& image, uint32_t stringTotal,
                           ValueDecodeState& state, uint32_t slot) {
  ConstValue node{};
  MC_READ(tag, cursor.readU8());
  switch (tag) {
  case kValueTagUnknown:
    node.kind = ConstValueKind::Unknown;
    break;
  case kValueTagVoid:
    node.kind = ConstValueKind::Void;
    break;
  case kValueTagNil:
    node.kind = ConstValueKind::Nil;
    break;
  case kValueTagBoolean: {
    MC_READ(raw, cursor.readU8());
    node.kind = ConstValueKind::Boolean;
    node.boolean = {raw != 0};
    break;
  }
  case kValueTagNumber: {
    float value = 0.0f;
    MC_CHECK(readNumberEntry(cursor, value));
    node.kind = ConstValueKind::Number;
    node.number = {value};
    break;
  }
  case kValueTagString: {
    MC_READ(stringIdx, cursor.readVarUint());
    MC_CHECK(checkStringIndex(stringIdx, stringTotal));
    node.kind = ConstValueKind::String;
    node.string = {stringIdx};
    break;
  }
  case kValueTagEnum: {
    MC_READ(typeIdx, cursor.readVarUint());
    MC_CHECK(checkTypeIndex(typeIdx, image));
    MC_READ(ordinal, cursor.readVarUint());
    const TypeEntry& entry = image.types[typeIdx];
    if (entry.tag == TypeTag::Enum) {
      if (ordinal >= entry.enumOf.symbolsCount) {
        return DecodeStatus::fail(LoadError::EnumOrdinalOutOfRange);
      }
    } else if (entry.tag != TypeTag::Atom) {
      // Atom enums resolve ordinals against the registered type at runtime;
      // any other entry kind cannot carry an enum constant.
      return DecodeStatus::fail(LoadError::InvalidValueTag);
    }
    node.kind = ConstValueKind::Enum;
    node.enumVal = {typeIdx, ordinal};
    break;
  }
  case kValueTagList: {
    MC_READ(typeIdx, cursor.readVarUint());
    MC_CHECK(checkTypeIndex(typeIdx, image));
    MC_READ(itemCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(itemCount, cursor));
    const uint32_t itemsOffset = state.valueCount;
    state.valueCount += itemCount;
    node.kind = ConstValueKind::List;
    node.list = {typeIdx, itemsOffset, itemCount};
    for (uint32_t i = 0; i < itemCount; i++) {
      MC_CHECK(readValueNode(cursor, image, stringTotal, state, itemsOffset + i));
    }
    break;
  }
  case kValueTagMap: {
    MC_READ(typeIdx, cursor.readVarUint());
    MC_CHECK(checkTypeIndex(typeIdx, image));
    MC_READ(entryCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(entryCount, cursor));
    const uint32_t entriesOffset = state.mapEntryCount;
    state.mapEntryCount += entryCount;
    node.kind = ConstValueKind::Map;
    node.map = {typeIdx, entriesOffset, entryCount};
    for (uint32_t i = 0; i < entryCount; i++) {
      ConstMapEntry mapEntry{};
      MC_READ(keyTag, cursor.readU8());
      if (keyTag > kMaxMapKeyTag) {
        return DecodeStatus::fail(LoadError::InvalidValueTag);
      }
      mapEntry.keyKind = static_cast<MapKeyKind>(keyTag);
      if (mapEntry.keyKind == MapKeyKind::Number) {
        float key = 0.0f;
        MC_CHECK(readNumberEntry(cursor, key));
        mapEntry.key.number = key;
      } else {
        MC_READ(keyStringIdx, cursor.readVarUint());
        MC_CHECK(checkStringIndex(keyStringIdx, stringTotal));
        mapEntry.key.stringIdx = keyStringIdx;
      }
      const uint32_t valueSlot = state.valueCount;
      state.valueCount += 1;
      mapEntry.valueIdx = valueSlot;
      if (state.mapEntries != nullptr) {
        state.mapEntries[entriesOffset + i] = mapEntry;
      }
      MC_CHECK(readValueNode(cursor, image, stringTotal, state, valueSlot));
    }
    break;
  }
  case kValueTagStruct: {
    MC_READ(typeIdx, cursor.readVarUint());
    MC_CHECK(checkTypeIndex(typeIdx, image));
    MC_READ(fieldCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(fieldCount, cursor));
    const uint32_t fieldsOffset = state.valueCount;
    state.valueCount += fieldCount;
    node.kind = ConstValueKind::Struct;
    node.structVal = {typeIdx, fieldsOffset, fieldCount};
    for (uint32_t i = 0; i < fieldCount; i++) {
      MC_CHECK(readValueNode(cursor, image, stringTotal, state, fieldsOffset + i));
    }
    break;
  }
  case kValueTagFunction: {
    MC_READ(funcId, cursor.readVarUint());
    MC_READ(biasedCaptureCount, cursor.readVarUint());
    node.kind = ConstValueKind::Function;
    if (biasedCaptureCount == 0) {
      node.function = {funcId, 0, 0, false};
    } else {
      const uint32_t captureCount = biasedCaptureCount - 1;
      MC_CHECK(checkCountFits(captureCount, cursor));
      const uint32_t capturesOffset = state.valueCount;
      state.valueCount += captureCount;
      node.function = {funcId, capturesOffset, captureCount, true};
      for (uint32_t i = 0; i < captureCount; i++) {
        MC_CHECK(readValueNode(cursor, image, stringTotal, state, capturesOffset + i));
      }
    }
    break;
  }
  case kValueTagBuffer: {
    MC_READ(byteCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(byteCount, cursor));
    MC_READ(bytes, cursor.readBytes(byteCount));
    node.kind = ConstValueKind::Buffer;
    node.buffer = {static_cast<uint32_t>(bytes.data() - image.stringData.data()), byteCount};
    break;
  }
  default:
    return DecodeStatus::fail(LoadError::InvalidValueTag);
  }
  if (state.values != nullptr) {
    state.values[slot] = node;
  }
  return DecodeStatus::ok();
}

DecodeStatus readCvalSection(ByteCursor& cursor, RegionArena& arena, uint32_t stringTotal,
                             ProgramImage& image) {
  MC_READ(poolCount, cursor.readVarUint());
  MC_CHECK(checkCountFits(poolCount, cursor));
  ByteCursor measure = cursor;
  ValueDecodeState counts{nullptr, nullptr, poolCount, 0};
  for (uint32_t i = 0; i < poolCount; i++) {
    MC_CHECK(readValueNode(measure, image, stringTotal, counts, i));
  }
  ConstValue* values = arena.allocate<ConstValue>(counts.valueCount);
  ConstMapEntry* mapEntries = arena.allocate<ConstMapEntry>(counts.mapEntryCount);
  if (values == nullptr || mapEntries == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  ValueDecodeState fill{values, mapEntries, poolCount, 0};
  for (uint32_t i = 0; i < poolCount; i++) {
    MC_CHECK(readValueNode(cursor, image, stringTotal, fill, i));
  }
  image.constValues = {values, counts.valueCount};
  image.constMapEntries = {mapEntries, counts.mapEntryCount};
  image.constantPools.valueCount = poolCount;
  return DecodeStatus::ok();
}

/** Decodes one instruction per its opcode's operand schema. */
DecodeStatus readInstruction(ByteCursor& cursor, Instr* out) {
  MC_READ(opByte, cursor.readU8());
  const Op op = static_cast<Op>(opByte);
  const OpOperandSchema* schema = operandSchemaFor(op);
  if (schema == nullptr) {
    return DecodeStatus::fail(LoadError::UnknownOpcode);
  }
  uint32_t operands[3] = {0, 0, 0};
  for (uint8_t i = 0; i < schema->operandCount; i++) {
    const OperandSpec& spec = schema->operands[i];
    if (spec.optional) {
      // Sentinel-biased: 0 = absent, value + 1 = present.
      MC_READ(sentinel, cursor.readVarUint());
      operands[i] = sentinel == 0 ? kNoTypeIdx : sentinel - 1;
    } else if (spec.encoding == OperandEncoding::SVar) {
      MC_READ(value, cursor.readVarInt());
      operands[i] = static_cast<uint32_t>(value);
    } else {
      MC_READ(value, cursor.readVarUint());
      operands[i] = value;
    }
  }
  if (out != nullptr) {
    *out = {op, operands[0], operands[1], operands[2]};
  }
  return DecodeStatus::ok();
}

/**
 * Decodes the FUNC bodies. With null `functions`/`instructions` the call is
 * a measure pass: it validates every instruction and reports the shared
 * instruction pool size in `instrTotal`.
 */
DecodeStatus readFuncBodies(ByteCursor& cursor, uint32_t funcCount, FunctionBytecode* functions,
                            Instr* instructions, uint32_t& instrTotal) {
  instrTotal = 0;
  for (uint32_t i = 0; i < funcCount; i++) {
    MC_READ(numParams, cursor.readVarUint());
    MC_READ(extraLocals, cursor.readVarUint());
    MC_READ(injectCtxBiased, cursor.readVarUint());
    MC_READ(instrCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(instrCount, cursor));
    const uint32_t codeOffset = instrTotal;
    instrTotal += instrCount;
    for (uint32_t j = 0; j < instrCount; j++) {
      Instr* out = instructions == nullptr ? nullptr : &instructions[codeOffset + j];
      MC_CHECK(readInstruction(cursor, out));
    }
    if (functions != nullptr) {
      // numLocals travels as extraLocals = numLocals - numParams; the biased
      // injectCtx index stores 0 for absent, idx + 1 for present.
      functions[i] = {codeOffset, instrCount, numParams, numParams + extraLocals,
                      injectCtxBiased == 0 ? kNoTypeIdx : injectCtxBiased - 1};
    }
  }
  return DecodeStatus::ok();
}

DecodeStatus readFuncSection(ByteCursor& cursor, RegionArena& arena, ProgramImage& image) {
  MC_READ(funcCount, cursor.readVarUint());
  MC_CHECK(checkCountFits(funcCount, cursor));
  ByteCursor measure = cursor;
  uint32_t instrTotal = 0;
  MC_CHECK(readFuncBodies(measure, funcCount, nullptr, nullptr, instrTotal));
  FunctionBytecode* functions = arena.allocate<FunctionBytecode>(funcCount);
  Instr* instructions = arena.allocate<Instr>(instrTotal);
  if (functions == nullptr || instructions == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  uint32_t filledInstrTotal = 0;
  MC_CHECK(readFuncBodies(cursor, funcCount, functions, instructions, filledInstrTotal));
  image.functions = {functions, funcCount};
  image.instructions = {instructions, instrTotal};
  return DecodeStatus::ok();
}

DecodeStatus readVarsSection(ByteCursor& cursor, RegionArena& arena, uint32_t stringTotal,
                             ProgramImage& image) {
  MC_READ(count, cursor.readVarUint());
  MC_CHECK(checkCountFits(count, cursor));
  uint32_t* names = arena.allocate<uint32_t>(count);
  if (names == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < count; i++) {
    MC_READ(nameIdx, cursor.readVarUint());
    MC_CHECK(checkStringIndex(nameIdx, stringTotal));
    names[i] = nameIdx;
  }
  image.variableNames = {names, count};
  return DecodeStatus::ok();
}

DecodeStatus readActsSection(ByteCursor& cursor, RegionArena& arena, ProgramImage& image) {
  MC_READ(count, cursor.readVarUint());
  MC_CHECK(checkCountFits(count, cursor));
  BytecodeAction* actions = arena.allocate<BytecodeAction>(count);
  if (actions == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < count; i++) {
    MC_READ(flags, cursor.readU8());
    MC_READ(entryFuncId, cursor.readVarUint());
    BytecodeAction action{entryFuncId, kNoFuncId, kNoFuncId, kNoFuncId};
    if ((flags & kActionFlagInitializer) != 0) {
      MC_READ(funcId, cursor.readVarUint());
      action.initializerFuncId = funcId;
    }
    if ((flags & kActionFlagActivation) != 0) {
      MC_READ(funcId, cursor.readVarUint());
      action.activationFuncId = funcId;
    }
    if ((flags & kActionFlagDeactivation) != 0) {
      MC_READ(funcId, cursor.readVarUint());
      action.deactivationFuncId = funcId;
    }
    actions[i] = action;
  }
  image.actions = {actions, count};
  return DecodeStatus::ok();
}

DecodeStatus readRulfSection(ByteCursor& cursor, RegionArena& arena, ProgramImage& image) {
  MC_READ(count, cursor.readVarUint());
  MC_CHECK(checkCountFits(count, cursor));
  uint32_t* funcIds = arena.allocate<uint32_t>(count);
  if (funcIds == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < count; i++) {
    MC_READ(funcId, cursor.readVarUint());
    funcIds[i] = funcId;
  }
  image.ruleFuncIds = {funcIds, count};
  return DecodeStatus::ok();
}

DecodeStatus readRancSection(ByteCursor& cursor, RegionArena& arena, ProgramImage& image) {
  MC_READ(count, cursor.readVarUint());
  MC_CHECK(checkCountFits(count, cursor));
  RuleAncestor* ancestors = arena.allocate<RuleAncestor>(count);
  if (ancestors == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < count; i++) {
    MC_READ(ruleFuncId, cursor.readVarUint());
    MC_READ(parentRuleFuncId, cursor.readVarUint());
    ancestors[i] = {ruleFuncId, parentRuleFuncId};
  }
  image.ruleAncestors = {ancestors, count};
  return DecodeStatus::ok();
}

DecodeStatus readSystSection(ByteCursor& cursor, RegionArena& arena, uint32_t stringTotal,
                             ProgramImage& image) {
  MC_READ(count, cursor.readVarUint());
  MC_CHECK(checkCountFits(count, cursor));
  SystemRegistration* systems = arena.allocate<SystemRegistration>(count);
  if (systems == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  for (uint32_t i = 0; i < count; i++) {
    MC_READ(flags, cursor.readU8());
    MC_READ(nameIdx, cursor.readVarUint());
    MC_CHECK(checkStringIndex(nameIdx, stringTotal));
    MC_READ(storeSlot, cursor.readVarUint());
    SystemRegistration system{nameIdx, storeSlot, kNoFuncId, kNoFuncId};
    if ((flags & kSystemFlagInit) != 0) {
      MC_READ(funcId, cursor.readVarUint());
      system.initFuncId = funcId;
    }
    if ((flags & kSystemFlagThink) != 0) {
      MC_READ(funcId, cursor.readVarUint());
      system.thinkFuncId = funcId;
    }
    systems[i] = system;
  }
  image.systems = {systems, count};
  return DecodeStatus::ok();
}

/**
 * Decodes the PAGE bodies. With null `pages`/`roots`/`callSites` the call is
 * a measure pass: it validates every page and reports the shared root-rule
 * and call-site pool sizes.
 */
DecodeStatus readPageBodies(ByteCursor& cursor, uint32_t pageCount, uint32_t stringTotal,
                            PageMetadata* pages, uint32_t* roots, ActionCallSite* callSites,
                            uint32_t& rootTotal, uint32_t& callSiteTotal) {
  rootTotal = 0;
  callSiteTotal = 0;
  for (uint32_t i = 0; i < pageCount; i++) {
    MC_READ(pageIndex, cursor.readVarUint());
    MC_READ(pageIdIdx, cursor.readVarUint());
    MC_CHECK(checkStringIndex(pageIdIdx, stringTotal));
    MC_READ(rootCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(rootCount, cursor));
    const uint32_t rootsOffset = rootTotal;
    rootTotal += rootCount;
    for (uint32_t j = 0; j < rootCount; j++) {
      MC_READ(funcId, cursor.readVarUint());
      if (roots != nullptr) {
        roots[rootsOffset + j] = funcId;
      }
    }
    MC_READ(callSiteCount, cursor.readVarUint());
    MC_CHECK(checkCountFits(callSiteCount, cursor));
    const uint32_t callSitesOffset = callSiteTotal;
    callSiteTotal += callSiteCount;
    for (uint32_t j = 0; j < callSiteCount; j++) {
      MC_READ(bindingTag, cursor.readU8());
      if (bindingTag > kMaxCallSiteBindingTag) {
        return DecodeStatus::fail(LoadError::InvalidValueTag);
      }
      MC_READ(callSiteId, cursor.readVarUint());
      MC_READ(boundId, cursor.readVarUint());
      if (callSites != nullptr) {
        callSites[callSitesOffset + j] = {static_cast<CallSiteBinding>(bindingTag), callSiteId,
                                          boundId};
      }
    }
    if (pages != nullptr) {
      pages[i] = {pageIndex, pageIdIdx, rootsOffset, rootCount, callSitesOffset, callSiteCount};
    }
  }
  return DecodeStatus::ok();
}

DecodeStatus readPageSection(ByteCursor& cursor, RegionArena& arena, uint32_t stringTotal,
                             ProgramImage& image) {
  MC_READ(pageCount, cursor.readVarUint());
  MC_CHECK(checkCountFits(pageCount, cursor));
  ByteCursor measure = cursor;
  uint32_t rootTotal = 0;
  uint32_t callSiteTotal = 0;
  MC_CHECK(readPageBodies(measure, pageCount, stringTotal, nullptr, nullptr, nullptr, rootTotal,
                          callSiteTotal));
  PageMetadata* pages = arena.allocate<PageMetadata>(pageCount);
  uint32_t* roots = arena.allocate<uint32_t>(rootTotal);
  ActionCallSite* callSites = arena.allocate<ActionCallSite>(callSiteTotal);
  if (pages == nullptr || roots == nullptr || callSites == nullptr) {
    return DecodeStatus::fail(LoadError::ArenaExhausted);
  }
  uint32_t filledRootTotal = 0;
  uint32_t filledCallSiteTotal = 0;
  MC_CHECK(readPageBodies(cursor, pageCount, stringTotal, pages, roots, callSites, filledRootTotal,
                          filledCallSiteTotal));
  image.pages = {pages, pageCount};
  image.rootRuleFuncIds = {roots, rootTotal};
  image.callSites = {callSites, callSiteTotal};
  return DecodeStatus::ok();
}

DecodeStatus decodeProgram(ByteSpan wire, RegionArena& arena, const ProgramReaderOptions& options,
                           ProgramImage& image) {
  ByteCursor cursor(wire);
  for (uint8_t expected : kMagic) {
    MC_READ(byte, cursor.readU8());
    if (byte != expected) {
      return DecodeStatus::fail(LoadError::InvalidMagic);
    }
  }
  MC_READ(formatVersion, cursor.readU8());
  if (formatVersion != kBinaryProgramFormatVersion) {
    return DecodeStatus::fail(LoadError::UnsupportedFormatVersion);
  }
  MC_READ(profileId, cursor.readVarUint());
  MC_READ(presence, cursor.readU8());

  image.profileId = profileId;
  image.stringData = wire;

  uint32_t stringTotal = 0;
  MC_CHECK(readCstrSection(cursor, arena, wire, image, stringTotal));
  MC_CHECK(readTypsSection(cursor, arena, stringTotal, options, image));
  MC_CHECK(readCnumSection(cursor, arena, image));
  MC_CHECK(readCvalSection(cursor, arena, stringTotal, image));
  MC_CHECK(readFuncSection(cursor, arena, image));
  MC_CHECK(readVarsSection(cursor, arena, stringTotal, image));
  image.hasActions = (presence & kPresenceActs) != 0;
  if (image.hasActions) {
    MC_CHECK(readActsSection(cursor, arena, image));
  }
  image.hasRuleFuncIds = (presence & kPresenceRulf) != 0;
  if (image.hasRuleFuncIds) {
    MC_CHECK(readRulfSection(cursor, arena, image));
  }
  image.hasRuleAncestors = (presence & kPresenceRanc) != 0;
  if (image.hasRuleAncestors) {
    MC_CHECK(readRancSection(cursor, arena, image));
  }
  image.hasSystems = (presence & kPresenceSyst) != 0;
  if (image.hasSystems) {
    MC_CHECK(readSystSection(cursor, arena, stringTotal, image));
  }
  MC_CHECK(readPageSection(cursor, arena, stringTotal, image));
  return DecodeStatus::ok();
}

} // namespace

Result<ProgramImage, LoadError> readProgramImage(ByteSpan wire, RegionArena& arena,
                                                 const ProgramReaderOptions& options) {
  ProgramImage image{};
  const DecodeStatus status = decodeProgram(wire, arena, options, image);
  if (!status.isOk()) {
    return Result<ProgramImage, LoadError>::fail(status.error());
  }
  return Result<ProgramImage, LoadError>::ok(image);
}

} // namespace mindcraft
