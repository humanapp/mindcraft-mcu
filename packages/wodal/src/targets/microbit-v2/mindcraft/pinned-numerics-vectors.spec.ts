import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { List } from "@mindcraft-lang/core";
import {
  CoreFuncId,
  type ExecutionContext,
  mkNumberValue,
  mkStringValue,
  NativeType,
  NIL_VALUE,
  type Value,
} from "@mindcraft-lang/core/runtime";
import { createMicroBitV2Environment } from "./environment";

// -- Golden value-vector emitter for the C++ pinned-numerics parity gate ------
//
// Dumps a golden input->output byte table for the pinned single-precision
// numeric bodies (the transcendentals, the number->string formatter, and the
// string->number parser), run through the microbit-v2 device environment so
// numbers are at the device's f32 profile. cpp/test/pinned-numerics-parity.test.cpp
// decodes each record's inputs, runs the C++ body, and byte-compares its encoded
// output to the committed expected bytes. The encoding is content-only and at the
// profile precision (f32), shared with the 6c host-function vector format:
//   0x01 nil | 0x02 bool b | 0x03 number <f32 LE bits> | 0x04 string <ulen><bytes>
// Numbers round to f32 (Math.fround); NaN is canonicalized to 0x7fc00000 so the
// gate is sign/payload-insensitive for NaN results.

const FIXTURE = fileURLToPath(new URL("./__fixtures__/pinned-numerics-vectors.bin", import.meta.url));

const services = createMicroBitV2Environment().brainServices;
const ctx: ExecutionContext = {
  services: services as unknown as ExecutionContext["services"],
  getVariableBySlot: () => NIL_VALUE,
  setVariableBySlot: () => {},
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
      default:
        throw new Error(`vector encoder: unsupported value tag ${String(v.t)}`);
    }
  }
}

const writer = new ByteWriter();
let recordCount = 0;

/** Runs a registered sync body and appends its input->output record. */
function emit(id: number, args: Value[]): void {
  const entry = services.runtime.functions.getSyncById(id);
  assert.ok(entry, `no sync host function registered for id ${id}`);
  const out = entry.fn.exec(ctx, List.from(args));
  recordCount++;
  writer.varuint(id);
  writer.varuint(args.length);
  for (const arg of args) {
    writer.value(arg);
  }
  writer.value(out);
}

/** Interprets a 32-bit pattern as an IEEE binary32 value. */
function f32(bits: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, bits >>> 0, true);
  return dv.getFloat32(0, true);
}

function num(x: number): Value {
  return mkNumberValue(Math.fround(x));
}

// Curated single-argument inputs covering reduction branches, domain edges,
// zeros (both signs), subnormals, the f32 extremes, and the non-finite cases.
const CURATED: number[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  0.25,
  0.1,
  0.7,
  0.9,
  0.99,
  0.9999,
  1.0001,
  2,
  -2,
  2.5,
  3,
  -3,
  10,
  -10,
  100,
  1000,
  1e6,
  1e7,
  16777216,
  0.0001,
  1e-5,
  1e-8,
  0.4142135,
  2.4142137,
  Math.PI / 4,
  Math.PI / 2,
  Math.PI,
  2 * Math.PI,
  8192.5,
  12345.678,
  -12345.678,
  1 / 3,
  Math.LN2,
  Math.E,
  f32(0x00000001),
  f32(0x007fffff),
  f32(0x00800000),
  f32(0x7f7fffff),
  f32(0xff7fffff),
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

// A deterministic pseudo-random sweep of bit patterns interpreted as f32, so the
// committed fixture covers a wide spread without depending on host randomness.
function lcgInputs(count: number): number[] {
  let state = 0x12345678 >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push(f32(state));
  }
  return out;
}

const SINGLE_ARG_INPUTS = [...CURATED, ...lcgInputs(160)];
const SINGLE_ARG_IDS = [
  CoreFuncId.MathSin,
  CoreFuncId.MathCos,
  CoreFuncId.MathTan,
  CoreFuncId.MathAsin,
  CoreFuncId.MathAcos,
  CoreFuncId.MathAtan,
  CoreFuncId.MathExp,
  CoreFuncId.MathLog,
];
for (const x of SINGLE_ARG_INPUTS) {
  for (const id of SINGLE_ARG_IDS) {
    emit(id, [num(x)]);
  }
}

// Two-argument transcendentals: atan2 and the two power ids (MathPow passes a
// NaN result through, OpPowerNumber maps NaN/bad operands to nil).
const PAIR_INPUTS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [0, 0],
  [-0, 0],
  [0, -0],
  [3, 4],
  [-3, 4],
  [3, -4],
  [-3, -4],
  [2, 10],
  [10, 2],
  [2, 0.5],
  [2, -0.5],
  [2, 3],
  [-2, 3],
  [-2, 2],
  [-2, 0.5],
  [9, 0.5],
  [4, -2],
  [0.5, 2],
  [10, -3],
  [1.5, 1.5],
  [2, 30],
  [2, -30],
  [100, 0],
  [5, 1],
  [-5, 3],
  [0, 0.5],
  [-0, -1],
  [1.0001, 1000],
  [Number.NaN, 1],
  [1, Number.NaN],
  [Number.POSITIVE_INFINITY, 2],
  [2, Number.POSITIVE_INFINITY],
  [Number.NEGATIVE_INFINITY, 3],
  [3, Number.NEGATIVE_INFINITY],
  [-1, Number.POSITIVE_INFINITY],
];
for (const [y, x] of PAIR_INPUTS) {
  emit(CoreFuncId.MathAtan2, [num(y), num(x)]);
}
for (const [b, e] of PAIR_INPUTS) {
  emit(CoreFuncId.MathPow, [num(b), num(e)]);
  emit(CoreFuncId.OpPowerNumber, [num(b), num(e)]);
}

// number -> string (shortest-round-trip f32 in the ECMAScript String grammar).
const FORMAT_INPUTS = [...CURATED, 1e21, 1e-7, 1e20, 123456.7, 0.000001, 1234567, 12345678, ...lcgInputs(120)];
for (const x of FORMAT_INPUTS) {
  emit(CoreFuncId.ConvNumberToString, [num(x)]);
}

// string -> number (parseFloat grammar, partial parse, no hex, NaN -> 0).
const PARSE_INPUTS = [
  "0",
  "-0",
  "1",
  "-1",
  "3.14",
  "  -3.14",
  "0.1",
  ".5",
  "5.",
  "1e3",
  "1e+5",
  "1e-7",
  "1.5e2",
  "12.5abc",
  "0x10",
  "1e",
  "1e+",
  "",
  "abc",
  "+",
  ".",
  "+.e3",
  "-",
  "Infinity",
  "-Infinity",
  "Infinity7",
  "  +Infinity",
  "1e39",
  "1e-46",
  "3.4028236e38",
  "1.0000001",
  "100",
  "1000000",
  "1e21",
  "0.0000001",
  "  42  ",
  "007",
  "3.",
  ".25",
  "2.5",
  "0.5",
  "1.5",
  "9007199254740993",
  "1.7976931348623157e308",
  "5e-324",
  "340282350000000000000000000000000000000",
];
for (const s of PARSE_INPUTS) {
  emit(CoreFuncId.ConvStringToNumber, [mkStringValue(s)]);
}

// -- Serialize ---------------------------------------------------------------
const header = new ByteWriter();
header.u8(0x4d); // 'M'
header.u8(0x43); // 'C'
header.u8(0x56); // 'V'
header.u8(0x31); // '1'
header.varuint(recordCount);
const fixture = Buffer.from([...header.bytes, ...writer.bytes]);

describe("pinned numeric parity vectors", () => {
  test("emit a stable golden input->output table for the C++ gate", () => {
    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, fixture);
    }
    const committed = readFileSync(FIXTURE);
    assert.ok(
      committed.equals(fixture),
      `pinned-numerics-vectors.bin is stale; delete ${FIXTURE} and re-run to regenerate`
    );
  });
});
