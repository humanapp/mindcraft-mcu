#include "core/codec/program-dump.h"

#include <cstring>

#include "core/runtime/bytecode.h"

namespace mindcraft {
namespace {

constexpr char kHexDigits[] = "0123456789abcdef";

/** Token-level writer for the line-oriented dump text. */
class DumpWriter {
public:
  explicit DumpWriter(DumpSink& sink) : sink_(sink) {}

  /** Two spaces per depth level. */
  void indent(uint32_t depth) {
    for (uint32_t i = 0; i < depth; i++) {
      text("  ");
    }
  }

  void text(const char* s) { sink_.write(s, strlen(s)); }

  void ch(char c) { sink_.write(&c, 1); }

  void nl() { ch('\n'); }

  /** Minimal lowercase hex of a u32 ("0" for zero). */
  void hex(uint32_t value) {
    char buf[8];
    size_t len = 0;
    do {
      buf[len++] = kHexDigits[value & 0xf];
      value >>= 4;
    } while (value != 0);
    for (size_t i = 0; i < len; i++) {
      ch(buf[len - 1 - i]);
    }
  }

  /** IEEE-754 bit pattern of an f32 value, 8 zero-padded lowercase hex digits. */
  void numberBits(float value) {
    uint32_t bits = 0;
    static_assert(sizeof(bits) == sizeof(value), "f32 bit patterns are 32-bit");
    memcpy(&bits, &value, sizeof(bits));
    for (int shift = 28; shift >= 0; shift -= 4) {
      ch(kHexDigits[(bits >> shift) & 0xf]);
    }
  }

private:
  DumpSink& sink_;
};

/**
 * Emits a string-table entry double-quoted: bytes 0x20..0x7e literal except
 * `"` and `\` (backslash-escaped); every other byte as `\xNN`. Returns false
 * when the index or its byte range is outside the image's pools.
 */
bool quoteString(DumpWriter& w, const ProgramImage& image, uint32_t stringIdx) {
  if (stringIdx >= image.strings.size()) {
    return false;
  }
  const StringRef ref = image.strings[stringIdx];
  if (ref.offset > image.stringData.size() || ref.length > image.stringData.size() - ref.offset) {
    return false;
  }
  w.ch('"');
  for (uint32_t i = 0; i < ref.length; i++) {
    const uint8_t b = image.stringData[ref.offset + i];
    if (b == 0x22) {
      w.text("\\\"");
    } else if (b == 0x5c) {
      w.text("\\\\");
    } else if (b >= 0x20 && b <= 0x7e) {
      w.ch(static_cast<char>(b));
    } else {
      w.text("\\x");
      w.ch(kHexDigits[b >> 4]);
      w.ch(kHexDigits[b & 0xf]);
    }
  }
  w.ch('"');
  return true;
}

bool emitTypeEntry(DumpWriter& w, const ProgramImage& image, uint32_t idx) {
  const TypeEntry& entry = image.types[idx];
  w.indent(1);
  w.text("type ");
  w.hex(idx);
  w.ch(' ');
  switch (entry.tag) {
  case TypeTag::Atom:
    w.text("atom ");
    w.hex(entry.atom.atomId);
    break;
  case TypeTag::List:
    w.text("list ");
    w.hex(entry.list.elem);
    break;
  case TypeTag::Map:
    w.text("map ");
    w.hex(entry.map.key);
    w.ch(' ');
    w.hex(entry.map.value);
    break;
  case TypeTag::Union: {
    if (entry.unionOf.membersOffset > image.typeRefs.size() ||
        entry.unionOf.membersCount > image.typeRefs.size() - entry.unionOf.membersOffset) {
      return false;
    }
    w.text("union ");
    w.hex(entry.unionOf.membersCount);
    for (uint32_t j = 0; j < entry.unionOf.membersCount; j++) {
      w.ch(' ');
      w.hex(image.typeRefs[entry.unionOf.membersOffset + j]);
    }
    break;
  }
  case TypeTag::Function: {
    if (entry.function.paramsOffset > image.typeRefs.size() ||
        entry.function.paramsCount > image.typeRefs.size() - entry.function.paramsOffset) {
      return false;
    }
    w.text("function ");
    w.hex(entry.function.paramsCount);
    for (uint32_t j = 0; j < entry.function.paramsCount; j++) {
      w.ch(' ');
      w.hex(image.typeRefs[entry.function.paramsOffset + j]);
    }
    w.ch(' ');
    w.hex(entry.function.result);
    break;
  }
  case TypeTag::Nullable:
    w.text("nullable ");
    w.hex(entry.nullable.base);
    break;
  case TypeTag::Struct:
    w.text("struct ");
    if (!quoteString(w, image, entry.structOf.nameStringIdx)) {
      return false;
    }
    w.text(" slots ");
    w.hex(entry.structOf.slotCount);
    break;
  case TypeTag::Enum: {
    if (entry.enumOf.symbolsOffset > image.typeRefs.size() ||
        entry.enumOf.symbolsCount > image.typeRefs.size() - entry.enumOf.symbolsOffset) {
      return false;
    }
    w.text("enum ");
    if (!quoteString(w, image, entry.enumOf.nameStringIdx)) {
      return false;
    }
    w.text(" symbols ");
    w.hex(entry.enumOf.symbolsCount);
    for (uint32_t j = 0; j < entry.enumOf.symbolsCount; j++) {
      w.ch(' ');
      if (!quoteString(w, image, image.typeRefs[entry.enumOf.symbolsOffset + j])) {
        return false;
      }
    }
    break;
  }
  default:
    return false;
  }
  w.nl();
  return true;
}

/**
 * Emits one value node at `slot` and, for containers, its children one
 * indent level deeper. A `labeled` node is a pool entry and leads with
 * `value <poolIdx> `.
 */
bool emitValueNode(DumpWriter& w, const ProgramImage& image, uint32_t depth, bool labeled,
                   uint32_t poolIdx, uint32_t slot) {
  if (slot >= image.constValues.size()) {
    return false;
  }
  const ConstValue& value = image.constValues[slot];
  w.indent(depth);
  if (labeled) {
    w.text("value ");
    w.hex(poolIdx);
    w.ch(' ');
  }
  switch (value.kind) {
  case ConstValueKind::Unknown:
    w.text("unknown");
    w.nl();
    return true;
  case ConstValueKind::Void:
    w.text("void");
    w.nl();
    return true;
  case ConstValueKind::Nil:
    w.text("nil");
    w.nl();
    return true;
  case ConstValueKind::Boolean:
    w.text(value.boolean.value ? "bool 1" : "bool 0");
    w.nl();
    return true;
  case ConstValueKind::Number:
    w.text("number ");
    w.numberBits(value.number.value);
    w.nl();
    return true;
  case ConstValueKind::String:
    w.text("string ");
    if (!quoteString(w, image, value.string.stringIdx)) {
      return false;
    }
    w.nl();
    return true;
  case ConstValueKind::Enum:
    w.text("enum ");
    w.hex(value.enumVal.typeIdx);
    w.ch(' ');
    w.hex(value.enumVal.ordinal);
    w.nl();
    return true;
  case ConstValueKind::List: {
    w.text("list ");
    w.hex(value.list.typeIdx);
    w.ch(' ');
    w.hex(value.list.itemsCount);
    w.nl();
    for (uint32_t i = 0; i < value.list.itemsCount; i++) {
      if (!emitValueNode(w, image, depth + 1, false, 0, value.list.itemsOffset + i)) {
        return false;
      }
    }
    return true;
  }
  case ConstValueKind::Map: {
    if (value.map.entriesOffset > image.constMapEntries.size() ||
        value.map.entriesCount > image.constMapEntries.size() - value.map.entriesOffset) {
      return false;
    }
    w.text("map ");
    w.hex(value.map.typeIdx);
    w.ch(' ');
    w.hex(value.map.entriesCount);
    w.nl();
    for (uint32_t i = 0; i < value.map.entriesCount; i++) {
      const ConstMapEntry& entry = image.constMapEntries[value.map.entriesOffset + i];
      w.indent(depth + 1);
      if (entry.keyKind == MapKeyKind::Number) {
        w.text("entry number ");
        w.numberBits(entry.key.number);
      } else if (entry.keyKind == MapKeyKind::String) {
        w.text("entry string ");
        if (!quoteString(w, image, entry.key.stringIdx)) {
          return false;
        }
      } else {
        return false;
      }
      w.nl();
      if (!emitValueNode(w, image, depth + 2, false, 0, entry.valueIdx)) {
        return false;
      }
    }
    return true;
  }
  case ConstValueKind::Struct: {
    w.text("struct ");
    w.hex(value.structVal.typeIdx);
    w.ch(' ');
    w.hex(value.structVal.fieldsCount);
    w.nl();
    for (uint32_t i = 0; i < value.structVal.fieldsCount; i++) {
      if (!emitValueNode(w, image, depth + 1, false, 0, value.structVal.fieldsOffset + i)) {
        return false;
      }
    }
    return true;
  }
  case ConstValueKind::Function: {
    w.text("function ");
    w.hex(value.function.funcId);
    w.text(" captures ");
    if (!value.function.hasCaptures) {
      w.ch('-');
      w.nl();
      return true;
    }
    w.hex(value.function.capturesCount);
    w.nl();
    for (uint32_t i = 0; i < value.function.capturesCount; i++) {
      if (!emitValueNode(w, image, depth + 1, false, 0, value.function.capturesOffset + i)) {
        return false;
      }
    }
    return true;
  }
  }
  return false;
}

bool emitInstruction(DumpWriter& w, const Instr& instr) {
  const OpOperandSchema* schema = operandSchemaFor(instr.op);
  if (schema == nullptr) {
    return false;
  }
  w.indent(2);
  w.text("instr ");
  w.hex(static_cast<uint32_t>(instr.op));
  const uint32_t operands[3] = {instr.a, instr.b, instr.c};
  for (uint8_t i = 0; i < schema->operandCount; i++) {
    w.ch(' ');
    if (schema->operands[i].optional && operands[i] == kNoTypeIdx) {
      w.ch('-');
    } else {
      w.hex(operands[i]);
    }
  }
  w.nl();
  return true;
}

/** Emits a funcId token, rendering the {@link kNoFuncId} sentinel as `-`. */
void emitOptionalFuncId(DumpWriter& w, uint32_t funcId) {
  if (funcId == kNoFuncId) {
    w.ch('-');
  } else {
    w.hex(funcId);
  }
}

} // namespace

bool writeCanonicalProgramDump(const ProgramImage& image, DumpSink& sink) {
  DumpWriter w(sink);

  w.text("mcprogram-dump ");
  w.hex(kCanonicalProgramDumpFormatVersion);
  w.nl();
  w.text("profile ");
  w.hex(image.profileId);
  w.nl();
  w.text("precision f32");
  w.nl();

  // Only the constant-pool prefix of the string table is dumped; aux strings
  // (type names, enum symbols, page ids, variable names) render in place.
  const uint32_t poolStringCount = image.constantPools.stringCount;
  if (poolStringCount > image.strings.size()) {
    return false;
  }
  w.text("strings ");
  w.hex(poolStringCount);
  w.nl();
  for (uint32_t i = 0; i < poolStringCount; i++) {
    w.indent(1);
    w.text("string ");
    w.hex(i);
    w.ch(' ');
    if (!quoteString(w, image, i)) {
      return false;
    }
    w.nl();
  }

  w.text("types ");
  w.hex(static_cast<uint32_t>(image.types.size()));
  w.nl();
  for (uint32_t i = 0; i < image.types.size(); i++) {
    if (!emitTypeEntry(w, image, i)) {
      return false;
    }
  }

  w.text("numbers ");
  w.hex(static_cast<uint32_t>(image.constNumbers.size()));
  w.nl();
  for (uint32_t i = 0; i < image.constNumbers.size(); i++) {
    w.indent(1);
    w.text("number ");
    w.hex(i);
    w.ch(' ');
    w.numberBits(image.constNumbers[i]);
    w.nl();
  }

  const uint32_t poolValueCount = image.constantPools.valueCount;
  if (poolValueCount > image.constValues.size()) {
    return false;
  }
  w.text("values ");
  w.hex(poolValueCount);
  w.nl();
  for (uint32_t i = 0; i < poolValueCount; i++) {
    if (!emitValueNode(w, image, 1, true, i, i)) {
      return false;
    }
  }

  w.text("functions ");
  w.hex(static_cast<uint32_t>(image.functions.size()));
  w.nl();
  for (uint32_t i = 0; i < image.functions.size(); i++) {
    const FunctionBytecode& fn = image.functions[i];
    if (fn.codeOffset > image.instructions.size() ||
        fn.codeCount > image.instructions.size() - fn.codeOffset) {
      return false;
    }
    w.indent(1);
    w.text("function ");
    w.hex(i);
    w.text(" params ");
    w.hex(fn.numParams);
    w.text(" locals ");
    w.hex(fn.numLocals);
    w.text(" ctx ");
    if (fn.injectCtxTypeIdx == kNoTypeIdx) {
      w.ch('-');
    } else {
      w.hex(fn.injectCtxTypeIdx);
    }
    w.text(" code ");
    w.hex(fn.codeCount);
    w.nl();
    for (uint32_t j = 0; j < fn.codeCount; j++) {
      if (!emitInstruction(w, image.instructions[fn.codeOffset + j])) {
        return false;
      }
    }
  }

  w.text("vars ");
  w.hex(static_cast<uint32_t>(image.variableNames.size()));
  w.nl();
  for (uint32_t i = 0; i < image.variableNames.size(); i++) {
    w.indent(1);
    w.text("var ");
    w.hex(i);
    w.ch(' ');
    if (!quoteString(w, image, image.variableNames[i])) {
      return false;
    }
    w.nl();
  }

  if (image.hasActions) {
    w.text("actions ");
    w.hex(static_cast<uint32_t>(image.actions.size()));
    w.nl();
    for (uint32_t i = 0; i < image.actions.size(); i++) {
      const BytecodeAction& action = image.actions[i];
      w.indent(1);
      w.text("action ");
      w.hex(i);
      w.text(" entry ");
      w.hex(action.entryFuncId);
      w.text(" init ");
      emitOptionalFuncId(w, action.initializerFuncId);
      w.text(" activate ");
      emitOptionalFuncId(w, action.activationFuncId);
      w.text(" deactivate ");
      emitOptionalFuncId(w, action.deactivationFuncId);
      w.nl();
    }
  }

  if (image.hasRuleFuncIds) {
    w.text("rulefuncs ");
    w.hex(static_cast<uint32_t>(image.ruleFuncIds.size()));
    w.nl();
    for (uint32_t i = 0; i < image.ruleFuncIds.size(); i++) {
      w.indent(1);
      w.text("rulefunc ");
      w.hex(i);
      w.ch(' ');
      w.hex(image.ruleFuncIds[i]);
      w.nl();
    }
  }

  if (image.hasRuleAncestors) {
    w.text("ruleancestors ");
    w.hex(static_cast<uint32_t>(image.ruleAncestors.size()));
    w.nl();
    for (uint32_t i = 0; i < image.ruleAncestors.size(); i++) {
      const RuleAncestor& edge = image.ruleAncestors[i];
      w.indent(1);
      w.text("ruleancestor ");
      w.hex(i);
      w.ch(' ');
      w.hex(edge.ruleFuncId);
      w.ch(' ');
      w.hex(edge.parentRuleFuncId);
      w.nl();
    }
  }

  w.text("pages ");
  w.hex(static_cast<uint32_t>(image.pages.size()));
  w.nl();
  for (uint32_t i = 0; i < image.pages.size(); i++) {
    const PageMetadata& page = image.pages[i];
    if (page.rootRuleFuncIdsOffset > image.rootRuleFuncIds.size() ||
        page.rootRuleFuncIdsCount > image.rootRuleFuncIds.size() - page.rootRuleFuncIdsOffset ||
        page.callSitesOffset > image.callSites.size() ||
        page.callSitesCount > image.callSites.size() - page.callSitesOffset) {
      return false;
    }
    w.indent(1);
    w.text("page ");
    w.hex(i);
    w.text(" index ");
    w.hex(page.pageIndex);
    w.text(" id ");
    if (!quoteString(w, image, page.pageIdStringIdx)) {
      return false;
    }
    w.text(" roots ");
    w.hex(page.rootRuleFuncIdsCount);
    w.text(" callsites ");
    w.hex(page.callSitesCount);
    w.nl();
    for (uint32_t j = 0; j < page.rootRuleFuncIdsCount; j++) {
      w.indent(2);
      w.text("root ");
      w.hex(image.rootRuleFuncIds[page.rootRuleFuncIdsOffset + j]);
      w.nl();
    }
    for (uint32_t j = 0; j < page.callSitesCount; j++) {
      const ActionCallSite& callSite = image.callSites[page.callSitesOffset + j];
      w.indent(2);
      if (callSite.binding == CallSiteBinding::Host) {
        w.text("callsite host ");
        w.hex(callSite.callSiteId);
        w.text(" action ");
        w.hex(callSite.boundId);
      } else if (callSite.binding == CallSiteBinding::Bytecode) {
        w.text("callsite bytecode ");
        w.hex(callSite.callSiteId);
        w.text(" slot ");
        w.hex(callSite.boundId);
      } else {
        return false;
      }
      w.nl();
    }
  }

  return true;
}

} // namespace mindcraft
