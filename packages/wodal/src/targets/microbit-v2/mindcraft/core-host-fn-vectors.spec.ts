import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { List } from "@mindcraft-lang/core";
import {
  CoreFuncId,
  type ExecutionContext,
  type ListTypeDef,
  type MapTypeDef,
  mkBooleanValue,
  mkListValue,
  mkNumberValue,
  mkStringValue,
  NativeType,
  NIL_VALUE,
  type Value,
  ValueDict,
} from "@mindcraft-lang/core/runtime";
import { createMicroBitV2Environment } from "./environment";

// -- Golden value-vector emitter for the C++ HOST_CALL parity gate ----------
//
// Dumps a golden input->output byte table per non-pinned CoreFuncId, running
// the core host-function bodies through the microbit-v2 device environment (so
// numbers are at the device's f32 profile). cpp/test/core-host-fn-parity.test.cpp
// decodes each record's inputs, runs the C++ body, and byte-compares its encoded
// output to the committed expected bytes. The encoding is content-only and at
// the profile precision (f32), so it captures exactly what the gate compares:
//   0x01 nil | 0x02 bool b | 0x03 number <f32 LE bits> | 0x04 string <ulen><bytes>
//   0x06 list <ucount><elem...> | 0x07 map <ucount>(<key><value>)...
// Numbers round to f32 (Math.fround); NaN is canonicalized to 0x7fc00000 so the
// gate is sign/payload-insensitive for NaN results.
//
// A list/map value carries a table-free structural encoding of its typeId after
// the tag, before the count:
//   0x00 atom <atomId> | 0x01 list <elem> | 0x02 map <key> <value> | 0xff none
// where each child is itself a structural type and 0xff marks an unresolved type.

const FIXTURE = fileURLToPath(new URL("./__fixtures__/core-host-fn-vectors.bin", import.meta.url));

const services = createMicroBitV2Environment().brainServices;
const types = services.runtime.types;
// The covered bodies (operators, conversions, math/string/map/element-access
// builtins) read only their args, so a minimal context suffices.
const ctx: ExecutionContext = {
  services: services as unknown as ExecutionContext["services"],
  getVariableBySlot: () => NIL_VALUE,
  setVariableBySlot: () => {},
  getSystemVarBySlot: () => NIL_VALUE,
  setSystemVarBySlot: () => {},
  time: 0,
  dt: 0,
  currentTick: 0,
};

class ByteWriter {
  readonly bytes: number[] = [];
  u8(b: number): void {
    this.bytes.push(b & 0xff);
  }
  varuint(n: number): void {
    let v = n >>> 0;
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.u8(v);
  }
  number(v: number): void {
    this.u8(0x03);
    const dv = new DataView(new ArrayBuffer(4));
    if (Number.isNaN(v)) {
      dv.setUint32(0, 0x7fc00000, true);
    } else {
      dv.setFloat32(0, Math.fround(v), true);
    }
    for (let i = 0; i < 4; i++) {
      this.u8(dv.getUint8(i));
    }
  }
  str(s: string): void {
    this.u8(0x04);
    const buf = Buffer.from(s, "utf8");
    this.varuint(buf.length);
    for (const b of buf) {
      this.u8(b);
    }
  }
  structuralType(typeId: string | undefined): void {
    const def = typeId === undefined ? undefined : types.get(typeId);
    if (def === undefined) {
      this.u8(0xff);
      return;
    }
    if (def.coreType === NativeType.List) {
      this.u8(0x01);
      this.structuralType((def as ListTypeDef).elementTypeId);
      return;
    }
    if (def.coreType === NativeType.Map) {
      this.u8(0x02);
      this.structuralType((def as MapTypeDef).keyTypeId);
      this.structuralType((def as MapTypeDef).valueTypeId);
      return;
    }
    if (def.atomId !== undefined) {
      this.u8(0x00);
      this.varuint(def.atomId);
      return;
    }
    this.u8(0xff);
  }
  value(v: Value): void {
    switch (v.t) {
      case NativeType.Nil:
        this.u8(0x01);
        return;
      case NativeType.Boolean:
        this.u8(0x02);
        this.u8(v.v ? 1 : 0);
        return;
      case NativeType.Number:
        this.number(v.v);
        return;
      case NativeType.String:
        this.str(v.v);
        return;
      case NativeType.List: {
        this.u8(0x06);
        this.structuralType(v.typeId);
        this.varuint(v.v.size());
        for (let i = 0; i < v.v.size(); i++) {
          this.value(v.v.get(i)!);
        }
        return;
      }
      case NativeType.Map: {
        this.u8(0x07);
        this.structuralType(v.typeId);
        const keys = v.v.keys();
        const vals = v.v.values();
        this.varuint(keys.size());
        for (let i = 0; i < keys.size(); i++) {
          const k = keys.get(i)!;
          if (typeof k === "number") {
            this.number(k);
          } else {
            this.str(k);
          }
          this.value(vals.get(i)!);
        }
        return;
      }
      default:
        throw new Error(`vector encoder: unsupported value tag ${String(v.t)}`);
    }
  }
}

// Input/value builders. Numeric inputs are pre-rounded to the profile precision
// so the body runs on the same f32 the device would see.
function n(x: number): Value {
  return mkNumberValue(Math.fround(x));
}
function s(x: string): Value {
  return mkStringValue(x);
}
function b(x: boolean): Value {
  return mkBooleanValue(x);
}
const nil = NIL_VALUE;
function lst(items: Value[]): Value {
  return mkListValue("list:<any>", List.from(items));
}
function mp(entries: Array<[string | number, Value]>): Value {
  return { t: NativeType.Map, typeId: "map:<any,any>", v: new ValueDict(entries) };
}

const writer = new ByteWriter();
const records: Array<{ id: number; args: Value[] }> = [];

/** Runs a non-pinned body and appends its input->output record. */
function emit(id: number, args: Value[]): void {
  const entry = services.runtime.functions.getSyncById(id);
  assert.ok(entry, `no sync host function registered for id ${id}`);
  const out = entry.fn.exec(ctx, List.from(args));
  records.push({ id, args });
  writer.varuint(id);
  writer.varuint(args.length);
  for (const arg of args) {
    writer.value(arg);
  }
  writer.value(out);
}

/** Appends a record whose output is supplied directly (the RNG stream). */
function emitRaw(id: number, args: Value[], out: Value): void {
  records.push({ id, args });
  writer.varuint(id);
  writer.varuint(args.length);
  for (const arg of args) {
    writer.value(arg);
  }
  writer.value(out);
}

// -- Boolean operators -------------------------------------------------------
emit(CoreFuncId.OpAndBoolean, [b(true), b(true)]);
emit(CoreFuncId.OpAndBoolean, [b(true), b(false)]);
emit(CoreFuncId.OpOrBoolean, [b(false), b(true)]);
emit(CoreFuncId.OpOrBoolean, [b(false), b(false)]);
emit(CoreFuncId.OpNotBoolean, [b(true)]);
emit(CoreFuncId.OpNotBoolean, [b(false)]);
emit(CoreFuncId.OpEqualToBoolean, [b(true), b(true)]);
emit(CoreFuncId.OpEqualToBoolean, [b(true), b(false)]);
emit(CoreFuncId.OpNotEqualToBoolean, [b(true), b(false)]);

// -- Arithmetic (f32 rounding, div0/mod0/NaN -> nil) -------------------------
emit(CoreFuncId.OpAddNumber, [n(0.1), n(0.2)]);
emit(CoreFuncId.OpAddNumber, [n(3.4e38), n(3.4e38)]); // overflow -> Infinity
emit(CoreFuncId.OpAddNumber, [n(Number.NaN), n(1)]); // nil
emit(CoreFuncId.OpSubtractNumber, [n(1 / 3), n(1e-8)]);
emit(CoreFuncId.OpMultiplyNumber, [n(1 / 3), n(1 / 3)]);
emit(CoreFuncId.OpDivideNumber, [n(1), n(3)]);
emit(CoreFuncId.OpDivideNumber, [n(1), n(0)]); // nil
emit(CoreFuncId.OpDivideNumber, [n(0), n(0)]); // nil
emit(CoreFuncId.OpModuloNumber, [n(10.1), n(3)]);
emit(CoreFuncId.OpModuloNumber, [n(5), n(0)]); // nil
emit(CoreFuncId.OpNegateNumber, [n(0.1)]);
emit(CoreFuncId.OpNegateNumber, [n(-2.5)]);

// -- Bitwise (ToInt32, signed >>) --------------------------------------------
emit(CoreFuncId.OpBitwiseAndNumber, [n(0x3fffffff), n(0x0000ffff)]);
emit(CoreFuncId.OpBitwiseOrNumber, [n(0x3ffffff), n(0)]); // wide -> f32 rounding
emit(CoreFuncId.OpBitwiseXorNumber, [n(0xff00), n(0x0ff0)]);
emit(CoreFuncId.OpBitwiseNotNumber, [n(0)]);
emit(CoreFuncId.OpBitwiseNotNumber, [n(5)]);
emit(CoreFuncId.OpLeftShiftNumber, [n(1), n(4)]);
emit(CoreFuncId.OpLeftShiftNumber, [n(1), n(31)]); // sign bit
emit(CoreFuncId.OpRightShiftNumber, [n(-8), n(1)]); // arithmetic
emit(CoreFuncId.OpRightShiftNumber, [n(256), n(2)]);

// -- Numeric comparisons (false on NaN) --------------------------------------
emit(CoreFuncId.OpEqualToNumber, [n(2), n(2)]);
emit(CoreFuncId.OpEqualToNumber, [n(2), n(3)]);
emit(CoreFuncId.OpNotEqualToNumber, [n(2), n(3)]);
emit(CoreFuncId.OpLessThanNumber, [n(1), n(2)]);
emit(CoreFuncId.OpLessThanNumber, [n(Number.NaN), n(2)]); // false
emit(CoreFuncId.OpLessThanOrEqualToNumber, [n(2), n(2)]);
emit(CoreFuncId.OpGreaterThanNumber, [n(3), n(2)]);
emit(CoreFuncId.OpGreaterThanOrEqualToNumber, [n(2), n(2)]);

// -- String operators --------------------------------------------------------
emit(CoreFuncId.OpAddString, [s("foo"), s("bar")]);
emit(CoreFuncId.OpAddString, [s(""), s("x")]);
emit(CoreFuncId.OpEqualToString, [s("abc"), s("abc")]);
emit(CoreFuncId.OpEqualToString, [s("abc"), s("abd")]);
emit(CoreFuncId.OpNotEqualToString, [s("abc"), s("abd")]);

// -- Nil comparisons (tag checks) --------------------------------------------
emit(CoreFuncId.OpEqualToNil, [nil, nil]);
emit(CoreFuncId.OpNotEqualToNil, [nil, nil]);
emit(CoreFuncId.OpNotNil, [nil]);
emit(CoreFuncId.OpEqualToNumberNil, [nil, nil]); // arg0 nil -> true
emit(CoreFuncId.OpEqualToNumberNil, [n(1), nil]); // arg0 number -> false
emit(CoreFuncId.OpEqualToNilNumber, [nil, nil]); // arg1 nil -> true
emit(CoreFuncId.OpEqualToNilNumber, [nil, n(1)]); // arg1 number -> false
emit(CoreFuncId.OpNotEqualToNumberNil, [n(1), nil]); // arg0 number -> true
emit(CoreFuncId.OpNotEqualToNilNumber, [nil, n(1)]); // arg1 number -> true
emit(CoreFuncId.OpEqualToBooleanNil, [b(true), nil]); // false
emit(CoreFuncId.OpEqualToBooleanNil, [nil, nil]); // true
emit(CoreFuncId.OpEqualToNilBoolean, [nil, b(true)]); // false
emit(CoreFuncId.OpNotEqualToBooleanNil, [b(true), nil]); // true
emit(CoreFuncId.OpNotEqualToNilBoolean, [nil, b(true)]); // true
emit(CoreFuncId.OpEqualToStringNil, [s("x"), nil]); // false
emit(CoreFuncId.OpEqualToStringNil, [nil, nil]); // true
emit(CoreFuncId.OpEqualToNilString, [nil, s("x")]); // false
emit(CoreFuncId.OpNotEqualToStringNil, [s("x"), nil]); // true
emit(CoreFuncId.OpNotEqualToNilString, [nil, s("x")]); // true

// -- Conversions (non-pinned) ------------------------------------------------
emit(CoreFuncId.ConvNumberToBoolean, [n(0)]);
emit(CoreFuncId.ConvNumberToBoolean, [n(5)]);
emit(CoreFuncId.ConvNumberToBoolean, [n(-0)]);
emit(CoreFuncId.ConvBooleanToNumber, [b(true)]);
emit(CoreFuncId.ConvBooleanToNumber, [b(false)]);
emit(CoreFuncId.ConvStringToBoolean, [s("x")]);
emit(CoreFuncId.ConvStringToBoolean, [s("   ")]);
emit(CoreFuncId.ConvStringToBoolean, [s("")]);
emit(CoreFuncId.ConvBooleanToString, [b(true)]);
emit(CoreFuncId.ConvBooleanToString, [b(false)]);

// -- Element access ----------------------------------------------------------
const triple = () => lst([n(10), n(20), n(30)]);
emit(CoreFuncId.ListGet, [triple(), n(1)]);
emit(CoreFuncId.ListGet, [triple(), n(5)]); // nil
emit(CoreFuncId.ListGet, [triple(), n(-1)]); // nil
emit(CoreFuncId.ListGet, [triple(), n(1.5)]); // nil
emit(CoreFuncId.ListGet, [triple(), s("length")]); // 3
emit(CoreFuncId.ListGet, [triple(), s("1")]); // 20
emit(CoreFuncId.ListGet, [triple(), s("01")]); // nil (leading zero)
emit(CoreFuncId.ListGet, [triple(), s("x")]); // nil
emit(CoreFuncId.StringGet, [s("hello"), n(1)]); // "e"
emit(CoreFuncId.StringGet, [s("hello"), n(5)]); // nil
emit(CoreFuncId.StringGet, [s("hello"), s("length")]); // 5
emit(CoreFuncId.StringGet, [s("hello"), s("0")]); // "h"

// -- Map builtins ------------------------------------------------------------
const strMap = () =>
  mp([
    ["a", n(1)],
    ["b", n(2)],
  ]);
const numMap = () =>
  mp([
    [1, s("x")],
    [2, s("y")],
  ]);
emit(CoreFuncId.MapKeys, [strMap()]); // ["a","b"]
emit(CoreFuncId.MapKeys, [numMap()]); // [1,2]
emit(CoreFuncId.MapValues, [strMap()]); // [1,2]
emit(CoreFuncId.MapValues, [numMap()]); // ["x","y"]
emit(CoreFuncId.MapSize, [strMap()]); // 2
emit(CoreFuncId.MapClear, [strMap()]); // {}

// -- Math builtins (exact) ---------------------------------------------------
emit(CoreFuncId.MathAbs, [n(-5)]);
emit(CoreFuncId.MathAbs, [n(-0)]);
emit(CoreFuncId.MathAbs, [n(3.5)]);
emit(CoreFuncId.MathCeil, [n(2.1)]);
emit(CoreFuncId.MathCeil, [n(-2.1)]);
emit(CoreFuncId.MathCeil, [n(-0.5)]); // -0
emit(CoreFuncId.MathFloor, [n(2.9)]);
emit(CoreFuncId.MathFloor, [n(-2.1)]);
emit(CoreFuncId.MathRound, [n(2.5)]);
emit(CoreFuncId.MathRound, [n(-2.5)]);
emit(CoreFuncId.MathRound, [n(0.5)]);
emit(CoreFuncId.MathRound, [n(-0.5)]); // -0
emit(CoreFuncId.MathRound, [n(2.4)]);
emit(CoreFuncId.MathRound, [n(0.5 - 2 ** -25)]); // largest f32 < 0.5 -> 0 (naive x+0.5f gives 1)
emit(CoreFuncId.MathRound, [n(-(0.5 - 2 ** -25))]); // -0
emit(CoreFuncId.MathMax, [n(2), n(5)]);
emit(CoreFuncId.MathMax, [n(-0), n(0)]); // +0
emit(CoreFuncId.MathMax, [n(Number.NaN), n(1)]); // NaN
emit(CoreFuncId.MathMin, [n(2), n(5)]);
emit(CoreFuncId.MathMin, [n(-0), n(0)]); // -0
emit(CoreFuncId.MathSqrt, [n(2)]);
emit(CoreFuncId.MathSqrt, [n(16)]);
emit(CoreFuncId.MathSqrt, [n(-1)]); // NaN
emit(CoreFuncId.MathSqrt, [n(0)]);

// -- String builtins ---------------------------------------------------------
emit(CoreFuncId.StrLength, [s("hello")]);
emit(CoreFuncId.StrLength, [s("")]);
emit(CoreFuncId.StrCharAt, [s("hello"), n(1)]);
emit(CoreFuncId.StrCharAt, [s("hello"), n(10)]); // ""
emit(CoreFuncId.StrCharCodeAt, [s("A"), n(0)]); // 65
emit(CoreFuncId.StrCharCodeAt, [s("A"), n(5)]); // NaN
emit(CoreFuncId.StrIndexOf, [s("hello"), s("l")]); // 2
emit(CoreFuncId.StrIndexOf, [s("hello"), s("l"), n(3)]); // 3
emit(CoreFuncId.StrIndexOf, [s("hello"), s("z")]); // -1
emit(CoreFuncId.StrIndexOf, [s("hello"), s("")]); // 0
emit(CoreFuncId.StrLastIndexOf, [s("hello"), s("l")]); // 3
emit(CoreFuncId.StrLastIndexOf, [s("hello"), s("l"), n(2)]); // 2
emit(CoreFuncId.StrLastIndexOf, [s("hello"), s("z")]); // -1
emit(CoreFuncId.StrSlice, [s("hello"), n(1), n(3)]); // "el"
emit(CoreFuncId.StrSlice, [s("hello"), n(-2)]); // "lo"
emit(CoreFuncId.StrSlice, [s("hello")]); // "hello"
emit(CoreFuncId.StrSlice, [s("hello"), n(1), n(-1)]); // "ell"
emit(CoreFuncId.StrSubstring, [s("hello"), n(1), n(3)]); // "el"
emit(CoreFuncId.StrSubstring, [s("hello"), n(3), n(1)]); // "el" (swap)
emit(CoreFuncId.StrSubstring, [s("hello"), n(-1), n(3)]); // "hel" (clamp)
emit(CoreFuncId.StrToLowerCase, [s("HeLLo")]);
emit(CoreFuncId.StrToUpperCase, [s("HeLLo")]);
emit(CoreFuncId.StrTrim, [s("  hi  ")]);
emit(CoreFuncId.StrSplit, [s("a,b,c"), s(",")]); // ["a","b","c"]
emit(CoreFuncId.StrSplit, [s("a,b,c"), s(","), n(2)]); // ["a","b"]
emit(CoreFuncId.StrSplit, [s("abc"), s("")]); // ["a","b","c"]
emit(CoreFuncId.StrSplit, [s(""), s("x")]); // [""]
emit(CoreFuncId.StrSplit, [s("a,,c"), s(",")]); // ["a","","c"]
emit(CoreFuncId.StrConcat, [s("a"), s("b"), s("c")]); // "abc"
emit(CoreFuncId.StrConcat, [s("a"), nil, s("c")]); // "ac"

// -- RNG stream (the exact LCG, seed 1) --------------------------------------
// MathRandom advances the VM-global LCG (math.node.ts MathOps.random), whose
// module seed is process-shared and not resettable. The expected stream is
// computed here from the pinned seed 1; the C++ gate draws from a fresh
// VmRng{1} in the same order.
let rngState = 1 >>> 0;
function rngNext(): number {
  rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
  return rngState / 4294967296;
}
for (let i = 0; i < 8; i++) {
  emitRaw(CoreFuncId.MathRandom, [], mkNumberValue(rngNext()));
}

// -- Serialize ---------------------------------------------------------------
const header = new ByteWriter();
header.u8(0x4d); // 'M'
header.u8(0x43); // 'C'
header.u8(0x56); // 'V'
header.u8(0x31); // '1'
header.varuint(records.length);
const fixture = Buffer.from([...header.bytes, ...writer.bytes]);

describe("core host-function parity vectors", () => {
  test("emit a stable golden input->output table for the C++ gate", () => {
    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, fixture);
    }
    const committed = readFileSync(FIXTURE);
    assert.ok(
      committed.equals(fixture),
      `core-host-fn-vectors.bin is stale; delete ${FIXTURE} and re-run to regenerate`
    );
  });
});
