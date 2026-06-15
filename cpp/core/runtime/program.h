#pragma once

#include <cstdint>
#include <type_traits>

#include "core/platform/span.h"
#include "core/runtime/bytecode.h"

namespace mindcraft {

/** Sentinel funcId marking an absent optional function reference. */
inline constexpr uint32_t kNoFuncId = 0xffffffffu;

/**
 * Sentinel type-table index marking an absent optional type reference.
 * Reserved: a program type table never reaches this index.
 */
inline constexpr uint32_t kNoTypeIdx = 0xffffffffu;

/**
 * Single decoded VM instruction: opcode plus up to three operands. Operand
 * slots beyond the opcode's schema arity are 0. A signed (`SVar`) operand
 * stores the decoded value's two's-complement bit pattern; cast to `int32_t`
 * to use it. An absent optional trailing operand holds {@link kNoTypeIdx}.
 */
struct Instr {
  Op op;
  uint32_t a;
  uint32_t b;
  uint32_t c;
};

/**
 * Compiled function body: a slice of the program's instruction pool plus
 * param/local counts.
 */
struct FunctionBytecode {
  /** Index of the function's first instruction in `ProgramImage::instructions`. */
  uint32_t codeOffset;
  /** Number of instructions in the function body. */
  uint32_t codeCount;
  /** Number of declared parameters. */
  uint32_t numParams;
  /** Total number of local variable slots, including params. */
  uint32_t numLocals;
  /**
   * Type-table index of the context struct type injected as the function's
   * implicit first argument, or {@link kNoTypeIdx} when the function takes
   * no injected context.
   */
  uint32_t injectCtxTypeIdx;
};

/**
 * One string table entry: a byte range of UTF-8 data inside
 * `ProgramImage::stringData`.
 */
struct StringRef {
  /** Byte offset of the string's first byte in `ProgramImage::stringData`. */
  uint32_t offset;
  /** Byte length of the string. */
  uint32_t length;
};

/**
 * Kind discriminant of a program type-table entry. The values are the wire
 * TYPS entry tags of the binary `.mcprogram` format (see
 * external/mindcraft-lang/packages/core/src/runtime/brain-program-binary-codec.ts)
 * and are wire-stable: never renumber.
 */
enum class TypeTag : uint8_t {
  Atom = 0,
  List = 1,
  Map = 2,
  Union = 3,
  Function = 4,
  Nullable = 5,
  Struct = 6,
  Enum = 7,
};

/**
 * One entry of a program's type table. Each entry describes one distinct
 * type the program references; child references are table indices strictly
 * less than the entry's own index. Only the payload member selected by
 * {@link tag} is meaningful.
 */
struct TypeEntry {
  /** Payload of an `Atom` entry: a core/target nominal type. */
  struct Atom {
    /** Stable type-atom id, resolved against the compiled-in atom mirrors. */
    uint32_t atomId;
  };

  /** Payload of a `List` entry: a parameterized list type. */
  struct ListOf {
    /** Type-table index of the element type. */
    uint32_t elem;
  };

  /** Payload of a `Map` entry: a parameterized map type. */
  struct MapOf {
    /** Type-table index of the key type. */
    uint32_t key;
    /** Type-table index of the value type. */
    uint32_t value;
  };

  /** Payload of a `Union` entry; members keep the registry's canonical sorted order. */
  struct UnionOf {
    /** Index of the first member type index in `ProgramImage::typeRefs`. */
    uint32_t membersOffset;
    /** Number of member type indices. */
    uint32_t membersCount;
  };

  /** Payload of a `Function` entry: a structural function type. */
  struct FunctionOf {
    /** Index of the first param type index in `ProgramImage::typeRefs`. */
    uint32_t paramsOffset;
    /** Number of param type indices. */
    uint32_t paramsCount;
    /** Type-table index of the result type. */
    uint32_t result;
  };

  /** Payload of a `Nullable` entry: a nullable wrapper around `base`. */
  struct NullableOf {
    /** Type-table index of the wrapped type. */
    uint32_t base;
  };

  /** Payload of a `Struct` entry: a program-local struct. Identity is the table position. */
  struct StructOf {
    /** String-table index of the registered type name. */
    uint32_t nameStringIdx;
    /**
     * Number of field storage slots (`maxFieldId + 1`); 0 for a fieldless
     * struct.
     */
    uint32_t slotCount;
    /**
     * Index of the first field name->id pair in `ProgramImage::structFields`.
     * The pairs map a field name to its storage slot; a struct accessed only by
     * static field id may carry none.
     */
    uint32_t fieldsOffset;
    /** Number of field name->id pairs. */
    uint32_t fieldsCount;
  };

  /** Payload of an `Enum` entry: a program-local enum. */
  struct EnumOf {
    /** String-table index of the registered type name. */
    uint32_t nameStringIdx;
    /**
     * Index of the first symbol string-table index in
     * `ProgramImage::typeRefs`; symbols are in declared order and enum
     * values reference them by ordinal.
     */
    uint32_t symbolsOffset;
    /** Number of symbols. */
    uint32_t symbolsCount;
  };

  TypeTag tag;
  union {
    Atom atom;
    ListOf list;
    MapOf map;
    UnionOf unionOf;
    FunctionOf function;
    NullableOf nullable;
    StructOf structOf;
    EnumOf enumOf;
  };
};

/** Kind discriminant of a decoded constant value. Local to the decoded image. */
enum class ConstValueKind : uint8_t {
  Unknown = 0,
  Void = 1,
  Nil = 2,
  Boolean = 3,
  Number = 4,
  String = 5,
  Enum = 6,
  List = 7,
  Map = 8,
  Struct = 9,
  Function = 10,
};

/** Key discriminant of a decoded constant map entry. The values are the wire
 * map-key tags of the binary `.mcprogram` format and are wire-stable. */
enum class MapKeyKind : uint8_t {
  Number = 0,
  String = 1,
};

/**
 * One decoded constant value. Container payloads reference contiguous runs
 * of child values in `ProgramImage::constValues` (or map entries in
 * `ProgramImage::constMapEntries`). Only the payload member selected by
 * {@link kind} is meaningful; `Unknown`, `Void`, and `Nil` carry no payload.
 */
struct ConstValue {
  /** Payload of a `Boolean` value. */
  struct BooleanVal {
    bool value;
  };

  /** Payload of a `Number` value, at the device profile's f32 precision. */
  struct NumberVal {
    float value;
  };

  /** Payload of a `String` value. */
  struct StringVal {
    /** String-table index of the string. */
    uint32_t stringIdx;
  };

  /** Payload of an `Enum` value. */
  struct EnumVal {
    /** Type-table index of the enum type. */
    uint32_t typeIdx;
    /** Symbol ordinal into the enum type's declared symbol list. */
    uint32_t ordinal;
  };

  /** Payload of a `List` value. */
  struct ListVal {
    /** Type-table index of the list type. */
    uint32_t typeIdx;
    /** Index of the first item in `ProgramImage::constValues`. */
    uint32_t itemsOffset;
    /** Number of items. */
    uint32_t itemsCount;
  };

  /** Payload of a `Map` value. */
  struct MapVal {
    /** Type-table index of the map type. */
    uint32_t typeIdx;
    /** Index of the first entry in `ProgramImage::constMapEntries`. */
    uint32_t entriesOffset;
    /** Number of entries, in insertion order. */
    uint32_t entriesCount;
  };

  /** Payload of a `Struct` value. */
  struct StructVal {
    /** Type-table index of the struct type. */
    uint32_t typeIdx;
    /** Index of the first field value in `ProgramImage::constValues`. */
    uint32_t fieldsOffset;
    /** Number of field values, in field-id order. */
    uint32_t fieldsCount;
  };

  /** Payload of a `Function` value. */
  struct FunctionVal {
    /** Stable funcId of the referenced function. */
    uint32_t funcId;
    /** Index of the first capture value in `ProgramImage::constValues`. */
    uint32_t capturesOffset;
    /** Number of capture values. Meaningful only when `hasCaptures` is true. */
    uint32_t capturesCount;
    /** True when the value carries a capture list (which may be empty). */
    bool hasCaptures;
  };

  ConstValueKind kind;
  union {
    BooleanVal boolean;
    NumberVal number;
    StringVal string;
    EnumVal enumVal;
    ListVal list;
    MapVal map;
    StructVal structVal;
    FunctionVal function;
  };
};

/** One program-local struct field's name -> id mapping. */
struct StructFieldRef {
  /** String-table index of the field name. */
  uint32_t nameStringIdx;
  /** Field storage slot (the numeric field id). */
  uint32_t fieldId;
};

/** One decoded constant map entry: a number-or-string key plus its value. */
struct ConstMapEntry {
  MapKeyKind keyKind;
  union {
    /** Key payload when `keyKind` is `Number`. */
    float number;
    /** String-table index when `keyKind` is `String`. */
    uint32_t stringIdx;
  } key;
  /** Index of the entry's value in `ProgramImage::constValues`. */
  uint32_t valueIdx;
};

/**
 * Sizes of the typed constant pools. Pool indices are independent: the same
 * numeric index in the number, string, and value pools references unrelated
 * entries.
 */
struct ConstantPools {
  /** Number of `PUSH_CONST_NUM`-addressable numbers (`ProgramImage::constNumbers`). */
  uint32_t numberCount;
  /**
   * Number of `PUSH_CONST_STR`-addressable strings: the leading entries of
   * `ProgramImage::strings`.
   */
  uint32_t stringCount;
  /**
   * Number of `PUSH_CONST_VAL`-addressable values: the leading entries of
   * `ProgramImage::constValues`.
   */
  uint32_t valueCount;
};

/**
 * Bytecode action binding: the funcIds invoked over the action's lifecycle.
 * Absent optional lifecycle functions hold {@link kNoFuncId}.
 */
struct BytecodeAction {
  /** FuncId of the action body. */
  uint32_t entryFuncId;
  /** FuncId of the one-time initializer, or {@link kNoFuncId}. */
  uint32_t initializerFuncId;
  /** FuncId of the per-page-activation hook, or {@link kNoFuncId}. */
  uint32_t activationFuncId;
  /** FuncId of the per-page-deactivation hook, or {@link kNoFuncId}. */
  uint32_t deactivationFuncId;
};

/** One rule-ancestor edge: a rule's funcId and its enclosing parent rule's funcId. */
struct RuleAncestor {
  uint32_t ruleFuncId;
  uint32_t parentRuleFuncId;
};

/** Binding kind of an action call site. The values are the wire call-site
 * binding tags of the binary `.mcprogram` format and are wire-stable. */
enum class CallSiteBinding : uint8_t {
  Host = 0,
  Bytecode = 1,
};

/** One action call site of a page. */
struct ActionCallSite {
  CallSiteBinding binding;
  /** Call-site id keying per-callsite state. */
  uint32_t callSiteId;
  /**
   * `Host` binding: the stable host-action id. `Bytecode` binding: the
   * program-local slot in `ProgramImage::actions`.
   */
  uint32_t boundId;
};

/** Decoded metadata of one brain page. */
struct PageMetadata {
  /** Page position in the brain's page list. */
  uint32_t pageIndex;
  /** String-table index of the page's id. */
  uint32_t pageIdStringIdx;
  /** Index of the first root-rule funcId in `ProgramImage::rootRuleFuncIds`. */
  uint32_t rootRuleFuncIdsOffset;
  /** Number of root-rule funcIds. */
  uint32_t rootRuleFuncIdsCount;
  /** Index of the first call site in `ProgramImage::callSites`. */
  uint32_t callSitesOffset;
  /** Number of call sites. */
  uint32_t callSitesCount;
};

/**
 * Decoded, read-only program image. All pool storage lives in one contiguous
 * arena allocation and entries reference each other by index, never by
 * pointer; the root's spans are the only pointers into the arena. String
 * bytes are borrowed from the encoded program buffer via
 * {@link stringData}, which must outlive the image.
 */
struct ProgramImage {
  /** Numeric device-profile id from the binary envelope header. */
  uint32_t profileId;

  /** Backing bytes for {@link StringRef} ranges (the encoded program buffer). */
  ByteSpan stringData;
  /**
   * The program-wide string table. The leading `constantPools.stringCount`
   * entries are the string constant pool; type names, enum symbols, page
   * ids, and variable names index anywhere in the table.
   */
  Span<const StringRef> strings;

  /** The program type table. Typed instruction operands index into it. */
  Span<const TypeEntry> types;
  /**
   * Backing pool for type-table runs: union member indices, function param
   * indices, and enum symbol string-table indices.
   */
  Span<const uint32_t> typeRefs;
  /** Backing pool for struct field name->id pairs referenced by `StructOf`. */
  Span<const StructFieldRef> structFields;

  /** Sizes of the typed constant pools. */
  ConstantPools constantPools;
  /** The number constant pool, at the device profile's f32 precision. */
  Span<const float> constNumbers;
  /**
   * The value constant pool plus nested children: the leading
   * `constantPools.valueCount` entries are the pool; container children
   * follow as contiguous runs.
   */
  Span<const ConstValue> constValues;
  /** Backing pool for map-value entry runs. */
  Span<const ConstMapEntry> constMapEntries;

  /** All functions' instructions, one contiguous pool. */
  Span<const Instr> instructions;
  /** The program's functions; funcIds index into this span. */
  Span<const FunctionBytecode> functions;

  /** Brain variable names as string-table indices; slot index is the position. */
  Span<const uint32_t> variableNames;

  /** True when the program carries an actions table (which may be empty). */
  bool hasActions;
  /** Bytecode action bindings keyed by program-local action slot. */
  Span<const BytecodeAction> actions;

  /** True when the program carries a rule-funcId set (which may be empty). */
  bool hasRuleFuncIds;
  /** FuncIds whose functions are rule entries. */
  Span<const uint32_t> ruleFuncIds;

  /** True when the program carries rule-ancestor edges (which may be empty). */
  bool hasRuleAncestors;
  /** Rule-to-parent-rule edges; a root rule has no entry. */
  Span<const RuleAncestor> ruleAncestors;

  /** The brain's pages. */
  Span<const PageMetadata> pages;
  /** Backing pool for the pages' root-rule funcId runs. */
  Span<const uint32_t> rootRuleFuncIds;
  /** Backing pool for the pages' action call-site runs. */
  Span<const ActionCallSite> callSites;
};

static_assert(std::is_trivially_copyable_v<Instr>, "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<FunctionBytecode>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<StringRef>, "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<TypeEntry>, "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<ConstValue>, "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<ConstMapEntry>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<StructFieldRef>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<BytecodeAction>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<RuleAncestor>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<ActionCallSite>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<PageMetadata>,
              "image structures stay trivially copyable");
static_assert(std::is_trivially_copyable_v<ProgramImage>,
              "image structures stay trivially copyable");

} // namespace mindcraft
