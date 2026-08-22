#include "doctest/doctest.h"

#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"

#include <array>
#include <cstdint>
#include <cstring>

using wendoo::ActionCallSite;
using wendoo::BytecodeAction;
using wendoo::ByteSpan;
using wendoo::CallSiteBinding;
using wendoo::ConstMapEntry;
using wendoo::ConstValue;
using wendoo::ConstValueKind;
using wendoo::CoreTypeAtomId;
using wendoo::FunctionBytecode;
using wendoo::Instr;
using wendoo::kNoFuncId;
using wendoo::kNoTypeIdx;
using wendoo::MapKeyKind;
using wendoo::Op;
using wendoo::PageMetadata;
using wendoo::ProgramImage;
using wendoo::RegionArena;
using wendoo::RuleAncestor;
using wendoo::Span;
using wendoo::StringRef;
using wendoo::TypeEntry;
using wendoo::TypeTag;

TEST_CASE("a synthetic program image constructs in one arena and reads back") {
  // String data stands in for the encoded program buffer the image borrows
  // string bytes from: "page-a" at [0, 6), "answer" at [6, 12).
  static const uint8_t kStringData[] = {'p', 'a', 'g', 'e', '-', 'a', 'a', 'n', 's', 'w', 'e', 'r'};

  alignas(8) std::array<uint8_t, 2048> storage{};
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));

  StringRef* strings = arena.allocate<StringRef>(2);
  REQUIRE(strings != nullptr);
  strings[0] = {0, 6};
  strings[1] = {6, 6};

  // Type table: [0] = atom Number, [1] = List<0>, [2] = enum with two
  // symbols whose names share the string table.
  TypeEntry* types = arena.allocate<TypeEntry>(3);
  REQUIRE(types != nullptr);
  types[0].tag = TypeTag::Atom;
  types[0].atom = {static_cast<uint32_t>(CoreTypeAtomId::Number)};
  types[1].tag = TypeTag::List;
  types[1].list = {0};
  types[2].tag = TypeTag::Enum;
  types[2].enumOf = {1, 0, 2, 2, false};

  uint32_t* typeRefs = arena.allocate<uint32_t>(4);
  REQUIRE(typeRefs != nullptr);
  typeRefs[0] = 0;
  typeRefs[1] = 1;
  typeRefs[2] = 0;          // 0.0f bit pattern: symbol 0's numeric value
  typeRefs[3] = 0x3f800000; // 1.0f bit pattern: symbol 1's numeric value

  float* numbers = arena.allocate<float>(2);
  REQUIRE(numbers != nullptr);
  numbers[0] = 1.5f;
  numbers[1] = -42.0f;

  // Value pool: one root list (typed List<Number>) whose two children
  // follow the root as a contiguous run.
  ConstValue* values = arena.allocate<ConstValue>(3);
  REQUIRE(values != nullptr);
  values[0].kind = ConstValueKind::List;
  values[0].list = {1, 1, 2};
  values[1].kind = ConstValueKind::Number;
  values[1].number = {2.5f};
  values[2].kind = ConstValueKind::String;
  values[2].string = {1};

  ConstMapEntry* mapEntries = arena.allocate<ConstMapEntry>(1);
  REQUIRE(mapEntries != nullptr);
  mapEntries[0].keyKind = MapKeyKind::String;
  mapEntries[0].key.stringIdx = 1;
  mapEntries[0].valueIdx = 1;

  Instr* instructions = arena.allocate<Instr>(4);
  REQUIRE(instructions != nullptr);
  instructions[0] = {Op::PUSH_CONST_NUM, 0, 0, 0};
  // Untyped constructor: the optional trailing operand is absent.
  instructions[1] = {Op::STRUCT_NEW, 0, kNoTypeIdx, 0};
  // Signed rel-offset operand, stored as the two's-complement bit pattern.
  instructions[2] = {Op::JMP, static_cast<uint32_t>(-2), 0, 0};
  instructions[3] = {Op::RET, 0, 0, 0};

  FunctionBytecode* functions = arena.allocate<FunctionBytecode>(1);
  REQUIRE(functions != nullptr);
  functions[0] = {0, 4, 1, 2, kNoTypeIdx};

  uint32_t* variableNames = arena.allocate<uint32_t>(1);
  REQUIRE(variableNames != nullptr);
  variableNames[0] = 1;

  BytecodeAction* actions = arena.allocate<BytecodeAction>(1);
  REQUIRE(actions != nullptr);
  actions[0] = {0, kNoFuncId, kNoFuncId, kNoFuncId};

  uint32_t* ruleFuncIds = arena.allocate<uint32_t>(1);
  REQUIRE(ruleFuncIds != nullptr);
  ruleFuncIds[0] = 0;

  RuleAncestor* ruleAncestors = arena.allocate<RuleAncestor>(0);
  REQUIRE(ruleAncestors != nullptr);

  uint32_t* rootRuleFuncIds = arena.allocate<uint32_t>(1);
  REQUIRE(rootRuleFuncIds != nullptr);
  rootRuleFuncIds[0] = 0;

  ActionCallSite* callSites = arena.allocate<ActionCallSite>(2);
  REQUIRE(callSites != nullptr);
  callSites[0] = {CallSiteBinding::Host, 7, 1025};
  callSites[1] = {CallSiteBinding::Bytecode, 8, 0};

  PageMetadata* pages = arena.allocate<PageMetadata>(1);
  REQUIRE(pages != nullptr);
  pages[0] = {0, 0, 0, 1, 0, 2};

  ProgramImage image{};
  image.profileId = 3;
  image.stringData = ByteSpan(kStringData, sizeof(kStringData));
  image.strings = {strings, 2};
  image.types = {types, 3};
  image.typeRefs = {typeRefs, 4};
  image.constantPools = {2, 2, 1};
  image.constNumbers = {numbers, 2};
  image.constValues = {values, 3};
  image.constMapEntries = {mapEntries, 1};
  image.instructions = {instructions, 4};
  image.functions = {functions, 1};
  image.variableNames = {variableNames, 1};
  image.hasActions = true;
  image.actions = {actions, 1};
  image.hasRuleFuncIds = true;
  image.ruleFuncIds = {ruleFuncIds, 1};
  image.hasRuleAncestors = false;
  image.ruleAncestors = {ruleAncestors, 0};
  image.pages = {pages, 1};
  image.rootRuleFuncIds = {rootRuleFuncIds, 1};
  image.callSites = {callSites, 2};

  // Strings resolve through stringData byte ranges.
  const StringRef& pageId = image.strings[image.pages[0].pageIdStringIdx];
  CHECK(memcmp(image.stringData.data() + pageId.offset, "page-a", pageId.length) == 0);
  const StringRef& varName = image.strings[image.variableNames[0]];
  CHECK(memcmp(image.stringData.data() + varName.offset, "answer", varName.length) == 0);

  // The type table resolves child references by index.
  CHECK(image.types[0].tag == TypeTag::Atom);
  CHECK(image.types[0].atom.atomId == static_cast<uint32_t>(CoreTypeAtomId::Number));
  CHECK(image.types[1].tag == TypeTag::List);
  CHECK(image.types[1].list.elem == 0);
  const TypeEntry::EnumOf& enumType = image.types[2].enumOf;
  CHECK(enumType.nameStringIdx == 1);
  REQUIRE(enumType.symbolsCount == 2);
  CHECK(image.typeRefs[enumType.symbolsOffset] == 0);
  CHECK(image.typeRefs[enumType.symbolsOffset + 1] == 1);
  CHECK(!enumType.stringValued);
  CHECK(image.typeRefs[enumType.valuesOffset] == 0);
  CHECK(image.typeRefs[enumType.valuesOffset + 1] == 0x3f800000);

  // The root constant value references its children as a contiguous run.
  const ConstValue& root = image.constValues[0];
  REQUIRE(root.kind == ConstValueKind::List);
  CHECK(root.list.typeIdx == 1);
  REQUIRE(root.list.itemsCount == 2);
  const ConstValue& item0 = image.constValues[root.list.itemsOffset];
  CHECK(item0.kind == ConstValueKind::Number);
  CHECK(item0.number.value == 2.5f);
  const ConstValue& item1 = image.constValues[root.list.itemsOffset + 1];
  CHECK(item1.kind == ConstValueKind::String);
  CHECK(item1.string.stringIdx == 1);
  CHECK(image.constMapEntries[0].keyKind == MapKeyKind::String);
  CHECK(image.constMapEntries[0].valueIdx == 1);

  // Function code is a slice of the shared instruction pool.
  const FunctionBytecode& fn = image.functions[0];
  CHECK(fn.injectCtxTypeIdx == kNoTypeIdx);
  REQUIRE(fn.codeOffset + fn.codeCount <= image.instructions.size());
  const Instr& jump = image.instructions[fn.codeOffset + 2];
  CHECK(jump.op == Op::JMP);
  CHECK(static_cast<int32_t>(jump.a) == -2);
  CHECK(image.instructions[fn.codeOffset + 1].b == kNoTypeIdx);

  // Lifecycle funcIds use the sentinel, never flags.
  CHECK(image.actions[0].entryFuncId == 0);
  CHECK(image.actions[0].initializerFuncId == kNoFuncId);
  CHECK(image.actions[0].activationFuncId == kNoFuncId);
  CHECK(image.actions[0].deactivationFuncId == kNoFuncId);
  CHECK(image.hasRuleAncestors == false);
  CHECK(image.ruleAncestors.empty());

  // Pages reference their run pools by offset and count.
  const PageMetadata& page = image.pages[0];
  CHECK(image.rootRuleFuncIds[page.rootRuleFuncIdsOffset] == 0);
  const ActionCallSite& hostSite = image.callSites[page.callSitesOffset];
  CHECK(hostSite.binding == CallSiteBinding::Host);
  CHECK(hostSite.callSiteId == 7);
  CHECK(hostSite.boundId == 1025);
  const ActionCallSite& bytecodeSite = image.callSites[page.callSitesOffset + 1];
  CHECK(bytecodeSite.binding == CallSiteBinding::Bytecode);
  CHECK(bytecodeSite.boundId == 0);

  // Everything above lives inside the single contiguous arena buffer.
  const uint8_t* lo = storage.data();
  const uint8_t* hi = storage.data() + arena.bytesUsed();
  auto inArena = [&](const void* p) {
    return reinterpret_cast<const uint8_t*>(p) >= lo && reinterpret_cast<const uint8_t*>(p) < hi;
  };
  CHECK(inArena(image.strings.data()));
  CHECK(inArena(image.types.data()));
  CHECK(inArena(image.constValues.data()));
  CHECK(inArena(image.instructions.data()));
  CHECK(inArena(image.callSites.data()));
}
