#include <cstdint>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "core/platform/span.h"
#include "core/runtime/core-func-id.h"
#include "core/runtime/core-host-functions.h"
#include "core/runtime/core-type-atom-id.h"
#include "core/runtime/managed-heap.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/type-registry.h"
#include "core/runtime/value.h"
#include "doctest/doctest.h"
#include "fixture-paths.h"

using namespace mindcraft;

namespace {

// The committed value vectors and this consumer share one f32-profile encoding
// (see core-host-fn-vectors.spec.ts):
//   0x01 nil | 0x02 bool b | 0x03 number <f32 LE bits> | 0x04 string <ulen><bytes>
//   0x06 list <structuralType><ucount><elem...>
//   0x07 map <structuralType><ucount>(<key><value>)...
// A structural typeId is 0x00 atom <atomId> | 0x01 list <elem> | 0x02 map <key>
// <value> | 0xff none, each child itself a structural type.

std::vector<uint8_t> readFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  REQUIRE_MESSAGE(in.good(), "missing fixture: " << path);
  return std::vector<uint8_t>((std::istreambuf_iterator<char>(in)),
                              std::istreambuf_iterator<char>());
}

/** A read cursor over the vector file. */
struct Cursor {
  const std::vector<uint8_t>& buf;
  size_t pos = 0;

  uint8_t u8() { return buf[pos++]; }

  uint32_t varuint() {
    uint32_t value = 0;
    uint32_t shift = 0;
    while (true) {
      const uint8_t byte = u8();
      value |= static_cast<uint32_t>(byte & 0x7f) << shift;
      if ((byte & 0x80) == 0) {
        break;
      }
      shift += 7;
    }
    return value;
  }

  float f32() {
    uint32_t bits = 0;
    for (uint32_t i = 0; i < 4; i++) {
      bits |= static_cast<uint32_t>(u8()) << (8 * i);
    }
    float f = 0;
    memcpy(&f, &bits, 4);
    return f;
  }
};

void encVaruint(std::vector<uint8_t>& out, uint32_t value) {
  while (value >= 0x80) {
    out.push_back(static_cast<uint8_t>((value & 0x7f) | 0x80));
    value >>= 7;
  }
  out.push_back(static_cast<uint8_t>(value));
}

void encNumber(std::vector<uint8_t>& out, float f) {
  out.push_back(0x03);
  uint32_t bits = 0;
  memcpy(&bits, &f, 4);
  if (f != f) {
    bits = 0x7fc00000; // canonical NaN, matching the emitter
  }
  for (uint32_t i = 0; i < 4; i++) {
    out.push_back(static_cast<uint8_t>((bits >> (8 * i)) & 0xff));
  }
}

void encString(std::vector<uint8_t>& out, const char* bytes, uint32_t length) {
  out.push_back(0x04);
  encVaruint(out, length);
  for (uint32_t i = 0; i < length; i++) {
    out.push_back(static_cast<uint8_t>(bytes[i]));
  }
}

/** Encodes the structural typeId of `typeIdx` against the gate's synthetic type table. */
void encStructuralType(const ProgramImage& prog, uint32_t typeIdx, std::vector<uint8_t>& out) {
  if (typeIdx >= prog.types.size()) {
    out.push_back(0xff);
    return;
  }
  const TypeEntry& entry = prog.types[typeIdx];
  if (entry.tag == TypeTag::List) {
    out.push_back(0x01);
    encStructuralType(prog, entry.list.elem, out);
  } else if (entry.tag == TypeTag::Map) {
    out.push_back(0x02);
    encStructuralType(prog, entry.map.key, out);
    encStructuralType(prog, entry.map.value, out);
  } else if (entry.tag == TypeTag::Atom) {
    out.push_back(0x00);
    encVaruint(out, entry.atom.atomId);
  } else {
    out.push_back(0xff);
  }
}

/** Encodes a runtime value into the vector encoding for byte comparison. */
void encodeValue(const ManagedHeap& heap, const ProgramImage& prog, const Value& v,
                 std::vector<uint8_t>& out) {
  if (v.isNil()) {
    out.push_back(0x01);
  } else if (v.isBoolean()) {
    out.push_back(0x02);
    out.push_back(v.asBoolean() ? 1 : 0);
  } else if (v.isNumber()) {
    encNumber(out, v.asNumber());
  } else if (v.isString()) {
    const char* bytes = nullptr;
    uint32_t length = 0;
    REQUIRE(heap.stringContent(v, bytes, length));
    encString(out, bytes, length);
  } else if (v.isList()) {
    const ListObject* list = heap.list(v);
    out.push_back(0x06);
    encStructuralType(prog, v.typeId(), out);
    encVaruint(out, list->size);
    for (uint32_t i = 0; i < list->size; i++) {
      encodeValue(heap, prog, list->items[i], out);
    }
  } else if (v.isMap()) {
    const MapObject* map = heap.map(v);
    out.push_back(0x07);
    encStructuralType(prog, v.typeId(), out);
    encVaruint(out, map->size);
    for (uint32_t i = 0; i < map->size; i++) {
      const MapEntry& entry = map->entries[i];
      if (entry.key.isNumber) {
        encNumber(out, entry.key.number);
      } else {
        const Value keyValue = entry.key.isManagedString
                                   ? Value::managedString(entry.key.stringRef)
                                   : Value::borrowedString(entry.key.stringRef);
        const char* bytes = nullptr;
        uint32_t length = 0;
        REQUIRE(heap.stringContent(keyValue, bytes, length));
        encString(out, bytes, length);
      }
      encodeValue(heap, prog, entry.value, out);
    }
  } else {
    FAIL("vector consumer: unencodable output value tag");
  }
}

/** Advances `cur` over one structural typeId node. */
void skipStructuralType(Cursor& cur) {
  const uint8_t tag = cur.u8();
  if (tag == 0x00) {
    cur.varuint();
  } else if (tag == 0x01) {
    skipStructuralType(cur);
  } else if (tag == 0x02) {
    skipStructuralType(cur);
    skipStructuralType(cur);
  }
}

/** Decodes one encoded value, materializing strings/containers in `heap`. */
Value decodeValue(Cursor& cur, ManagedHeap& heap) {
  const uint8_t tag = cur.u8();
  switch (tag) {
  case 0x01:
    return kNilValue;
  case 0x02:
    return Value::boolean(cur.u8() != 0);
  case 0x03:
    return Value::number(cur.f32());
  case 0x04: {
    const uint32_t length = cur.varuint();
    const char* bytes = reinterpret_cast<const char*>(cur.buf.data()) + cur.pos;
    cur.pos += length;
    Value out;
    REQUIRE(heap.newString(bytes, length, nullptr, out));
    return out;
  }
  case 0x06: {
    skipStructuralType(cur);
    const uint32_t count = cur.varuint();
    Value listValue;
    REQUIRE(heap.newList(kNoTypeIdx, nullptr, listValue));
    for (uint32_t i = 0; i < count; i++) {
      const Value element = decodeValue(cur, heap);
      REQUIRE(heap.listPush(heap.list(listValue), element, nullptr));
    }
    return listValue;
  }
  case 0x07: {
    skipStructuralType(cur);
    const uint32_t count = cur.varuint();
    Value mapValue;
    REQUIRE(heap.newMap(kNoTypeIdx, nullptr, mapValue));
    for (uint32_t i = 0; i < count; i++) {
      const Value keyValue = decodeValue(cur, heap);
      const Value entryValue = decodeValue(cur, heap);
      MapKey key{};
      if (keyValue.isNumber()) {
        key = MapKey{true, false, keyValue.asNumber(), 0};
      } else {
        key = MapKey{false, keyValue.isManagedString(), 0.0f,
                     keyValue.stringRef() & kStringRefIndexMask};
      }
      REQUIRE(heap.mapSet(heap.map(mapValue), key, entryValue, nullptr));
    }
    return mapValue;
  }
  default:
    FAIL("vector consumer: unknown encoded tag");
    return kNilValue;
  }
}

/** Advances `cur` over one encoded value without materializing it. */
void skipValue(Cursor& cur) {
  const uint8_t tag = cur.u8();
  switch (tag) {
  case 0x01:
    return;
  case 0x02:
    cur.u8();
    return;
  case 0x03:
    cur.pos += 4;
    return;
  case 0x04:
    cur.pos += cur.varuint();
    return;
  case 0x06: {
    skipStructuralType(cur);
    const uint32_t count = cur.varuint();
    for (uint32_t i = 0; i < count; i++) {
      skipValue(cur);
    }
    return;
  }
  case 0x07: {
    skipStructuralType(cur);
    const uint32_t count = cur.varuint();
    for (uint32_t i = 0; i < count; i++) {
      skipValue(cur);
      skipValue(cur);
    }
    return;
  }
  default:
    FAIL("vector consumer: unknown encoded tag in skip");
  }
}

std::string hex(const uint8_t* bytes, size_t length) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < length; i++) {
    out.push_back(digits[bytes[i] >> 4]);
    out.push_back(digits[bytes[i] & 0x0f]);
  }
  return out;
}

} // namespace

TEST_CASE("every committed CoreFuncId vector byte-matches the C++ host-function body") {
  const std::string path =
      std::string(mindcraft::test::kWodalFixturesDir) + "/core-host-fn-vectors.bin";
  const std::vector<uint8_t> buf = readFile(path);

  Cursor cur{buf, 0};
  REQUIRE(cur.u8() == 'M');
  REQUIRE(cur.u8() == 'C');
  REQUIRE(cur.u8() == 'V');
  REQUIRE(cur.u8() == '1');
  const uint32_t recordCount = cur.varuint();
  REQUIRE(recordCount > 0);

  // A generous standalone working region: the gate disables collection (null
  // roots) and never frees, so it only needs to hold every decoded input.
  std::vector<uint8_t> storage(8 * 1024 * 1024);
  RegionArena arena(Span<uint8_t>(storage.data(), storage.size()));
  ManagedHeap heap(arena);
  // One VM-global RNG seeded from the pinned default, shared across the run;
  // only the MathRandom records draw from it, in emission order.
  VmRng rng;

  // A type table with String/Any atoms and List<String> / List<Any> types.
  TypeEntry typeTable[4];
  typeTable[0].tag = TypeTag::Atom;
  typeTable[0].atom = {static_cast<uint32_t>(CoreTypeAtomId::String)};
  typeTable[1].tag = TypeTag::Atom;
  typeTable[1].atom = {static_cast<uint32_t>(CoreTypeAtomId::Any)};
  typeTable[2].tag = TypeTag::List;
  typeTable[2].list = {0};
  typeTable[3].tag = TypeTag::List;
  typeTable[3].list = {1};
  ProgramImage typeProgram{};
  typeProgram.types = {typeTable, 4};
  const TypeRegistry registry(typeProgram);

  for (uint32_t r = 0; r < recordCount; r++) {
    const uint32_t funcId = cur.varuint();
    const uint32_t argc = cur.varuint();
    std::vector<Value> args;
    args.reserve(argc);
    for (uint32_t i = 0; i < argc; i++) {
      args.push_back(decodeValue(cur, heap));
    }
    const size_t expectedStart = cur.pos;
    skipValue(cur);
    const size_t expectedEnd = cur.pos;

    const HostCallEnv env{&heap, nullptr, &rng, &registry};
    Value out;
    const Status status = callCoreHostFunction(
        static_cast<CoreFuncId>(funcId), Span<const Value>(args.data(), args.size()), env, out);

    INFO("record " << r << " funcId " << funcId);
    REQUIRE(status.isOk());

    std::vector<uint8_t> encoded;
    encodeValue(heap, typeProgram, out, encoded);

    const size_t expectedLen = expectedEnd - expectedStart;
    INFO("expected " << hex(buf.data() + expectedStart, expectedLen) << " got "
                     << hex(encoded.data(), encoded.size()));
    CHECK(encoded.size() == expectedLen);
    CHECK(memcmp(encoded.data(), buf.data() + expectedStart, expectedLen) == 0);
  }
}
