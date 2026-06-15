#pragma once

#include <cstdint>
#include <cstring>

#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace mindcraft {

/** Reads a native struct field by id, returning the field value. */
using NativeStructFieldGetter = Value (*)(const Value& source, uint32_t fieldId);

/**
 * Writes a native struct field by id. Returns false to reject the write (e.g. a
 * read-only field).
 */
using NativeStructFieldSetter = bool (*)(const Value& source, uint32_t fieldId, const Value& value);

/**
 * Resolves type identities against the decoded program image: program-local
 * struct field names and slot counts, the instantiated container types the core
 * builtins produce, and the optional native field getter/setter of a struct
 * type. Mirrors the role of `runtime.types` in
 * external/mindcraft-lang/packages/core/src/runtime/vm.ts on the device.
 *
 * A program-local struct has no native getter/setter; its fields are managed
 * slab slots indexed by field id.
 */
class TypeRegistry {
public:
  explicit TypeRegistry(const ProgramImage& program) : program_(&program) {}

  /** The decoded program image this registry resolves against. */
  const ProgramImage& program() const { return *program_; }

  /** Field storage slot count of struct `typeIdx`, or 0 when it is not a struct. */
  uint32_t structSlotCount(uint32_t typeIdx) const {
    if (typeIdx >= program_->types.size()) {
      return 0;
    }
    const TypeEntry& entry = program_->types[typeIdx];
    return entry.tag == TypeTag::Struct ? entry.structOf.slotCount : 0;
  }

  /**
   * Resolves field name `name` (`length` bytes) to its storage slot on struct
   * `typeIdx`. Writes the slot to `fieldId` and returns true on a match;
   * returns false when `typeIdx` is not a struct or carries no such field.
   */
  bool findStructField(uint32_t typeIdx, const char* name, uint32_t length,
                       uint32_t& fieldId) const {
    if (typeIdx >= program_->types.size()) {
      return false;
    }
    const TypeEntry& entry = program_->types[typeIdx];
    if (entry.tag != TypeTag::Struct) {
      return false;
    }
    for (uint32_t i = 0; i < entry.structOf.fieldsCount; i++) {
      const StructFieldRef& field = program_->structFields[entry.structOf.fieldsOffset + i];
      const StringRef& ref = program_->strings[field.nameStringIdx];
      if (ref.length == length &&
          (length == 0 ||
           std::memcmp(program_->stringData.data() + ref.offset, name, length) == 0)) {
        fieldId = field.fieldId;
        return true;
      }
    }
    return false;
  }

  /** Type-table index of `List<elemTypeIdx>`, or {@link kNoTypeIdx} when the program has none. */
  uint32_t findListType(uint32_t elemTypeIdx) const {
    for (uint32_t i = 0; i < program_->types.size(); i++) {
      const TypeEntry& entry = program_->types[i];
      if (entry.tag == TypeTag::List && entry.list.elem == elemTypeIdx) {
        return i;
      }
    }
    return kNoTypeIdx;
  }

  /** Type-table index of `Map<keyTypeIdx,valueTypeIdx>`, or {@link kNoTypeIdx} when absent. */
  uint32_t findMapType(uint32_t keyTypeIdx, uint32_t valueTypeIdx) const {
    for (uint32_t i = 0; i < program_->types.size(); i++) {
      const TypeEntry& entry = program_->types[i];
      if (entry.tag == TypeTag::Map && entry.map.key == keyTypeIdx &&
          entry.map.value == valueTypeIdx) {
        return i;
      }
    }
    return kNoTypeIdx;
  }

  /** Type-table index of the core/target atom type `atomId`, or {@link kNoTypeIdx} when absent. */
  uint32_t findAtomType(uint32_t atomId) const {
    for (uint32_t i = 0; i < program_->types.size(); i++) {
      const TypeEntry& entry = program_->types[i];
      if (entry.tag == TypeTag::Atom && entry.atom.atomId == atomId) {
        return i;
      }
    }
    return kNoTypeIdx;
  }

  /** The native field getter registered for struct `typeIdx`, or null for a managed-slot struct. */
  NativeStructFieldGetter nativeStructGetter(uint32_t /*typeIdx*/) const { return nullptr; }

  /** The native field setter registered for struct `typeIdx`, or null for a managed-slot struct. */
  NativeStructFieldSetter nativeStructSetter(uint32_t /*typeIdx*/) const { return nullptr; }

private:
  const ProgramImage* program_;
};

} // namespace mindcraft
