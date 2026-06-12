/**
 * Golden binary `.mcprogram` fixtures for the WODAL emit seam.
 *
 * Each binary golden is generated reproducibly from the committed JSON golden
 * beside it: `fromJson -> profile image -> serializeWodalProgramImageBytes`.
 * The test (1) regenerates the binary if it is missing, (2) asserts the
 * committed binary is byte-stable against a fresh generation, (3) decodes the
 * binary and asserts JSON-vs-binary equivalence over the f32-rounded,
 * lean-normalized payload, and (4) reports the per-section byte breakdown.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { stream } from "@mindcraft-lang/core";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  type BrainProgramValueJson,
  binaryProgramByteReport,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  linkedBrainProgramToJson,
  type NumberPrecision,
} from "@mindcraft-lang/core/runtime";
import { createMicroBitV2Module } from "../targets/microbit-v2/mindcraft/module";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "./device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "./program-image-binary";

const typeRegistry = createMindcraftEnvironment({
  modules: [coreModule(), createMicroBitV2Module()],
}).brainServices.runtime.types;

interface ProgramImageEnvelopeJson {
  readonly format: string;
  readonly version: number;
  readonly profileId: string;
  readonly program: LinkedBrainProgramJson;
}

const FIXTURE_DIR = "../targets/microbit-v2/mindcraft/__fixtures__";

const GOLDENS = [
  { name: "button-display", binding: "host actions" },
  { name: "user-tile-button-display", binding: "bytecode actions" },
] as const;

// ---- Lean normalization (mirrors the binary codec's documented invariant) ----

function round(value: number, precision: NumberPrecision): number {
  return precision === "f32" ? Math.fround(value) : value;
}

function normalizeValue(value: BrainProgramValueJson, precision: NumberPrecision): BrainProgramValueJson {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const obj = value as { readonly [key: string]: BrainProgramValueJson };
  switch (obj.t) {
    case 3: // Number
      return { t: 3, v: round(obj.v as number, precision) };
    case 6: // List
      return {
        t: 6,
        typeId: obj.typeId,
        v: (obj.v as BrainProgramValueJson[]).map((x) => normalizeValue(x, precision)),
      };
    case 8: // Struct
      return {
        t: 8,
        typeId: obj.typeId,
        v: ((obj.v ?? []) as BrainProgramValueJson[]).map((x) => normalizeValue(x, precision)),
      };
    case 7: // Map
      return {
        t: 7,
        typeId: obj.typeId,
        v: (obj.v as { key: string | number; value: BrainProgramValueJson }[]).map((entry) => ({
          key: typeof entry.key === "number" ? round(entry.key, precision) : entry.key,
          value: normalizeValue(entry.value, precision),
        })),
      };
    case 11: // Function
      return obj.captures === undefined
        ? value
        : {
            t: 11,
            funcId: obj.funcId,
            captures: (obj.captures as BrainProgramValueJson[]).map((x) => normalizeValue(x, precision)),
          };
    default:
      return value;
  }
}

function leanNormalize(json: LinkedBrainProgramJson, precision: NumberPrecision): LinkedBrainProgramJson {
  const p = json.program;
  return {
    program: {
      version: p.version,
      functions: p.functions.map((fn) => ({
        code: fn.code.map((instr) => ({ ...instr })),
        numParams: fn.numParams,
        numLocals: fn.numLocals ?? fn.numParams,
        ...(fn.injectCtxTypeIdx !== undefined ? { injectCtxTypeIdx: fn.injectCtxTypeIdx } : {}),
      })),
      constantPools: {
        numbers: p.constantPools.numbers.map((n) => round(n, precision)),
        strings: p.constantPools.strings,
        values: p.constantPools.values.map((v) => normalizeValue(v, precision)),
      },
      types: p.types ?? [],
      variableNames: p.variableNames,
      ...(p.actions !== undefined ? { actions: p.actions } : {}),
      ...(p.ruleFuncIds !== undefined ? { ruleFuncIds: p.ruleFuncIds } : {}),
      ...(p.ruleAncestors !== undefined ? { ruleAncestors: p.ruleAncestors } : {}),
    },
    pages: json.pages.map((page) => ({ ...page, pageName: "" })),
  };
}

// ---- Test ----

function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`${FIXTURE_DIR}/${relative}`, import.meta.url));
}

function buildBinary(envelope: ProgramImageEnvelopeJson): Uint8Array {
  const program = linkedBrainProgramFromJson(envelope.program);
  const image = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2).createProgramImage(program);
  return serializeWodalProgramImageBytes(image, typeRegistry);
}

for (const golden of GOLDENS) {
  test(`the ${golden.name} binary golden (${golden.binding}) is reproducible and round-trips`, () => {
    const jsonPath = fixturePath(`${golden.name}.mcprogram`);
    const binPath = fixturePath(`${golden.name}.mcprogram.bin`);
    const envelope = JSON.parse(readFileSync(jsonPath, "utf8")) as ProgramImageEnvelopeJson;
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);

    const generated = Buffer.from(buildBinary(envelope));
    if (!existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const committed = readFileSync(binPath);

    // (2) Byte-stable: the committed golden matches a fresh deterministic build.
    assert.ok(committed.equals(generated), `${golden.name}.mcprogram.bin is not byte-stable`);

    // (3) JSON-vs-binary equivalence over the f32-rounded, lean-normalized payload.
    const decoded = parseWodalProgramImageBytes(
      new Uint8Array(committed),
      WodalDeviceProfileId.MICROBIT_V2,
      typeRegistry
    );
    assert.equal(decoded.profileId, profile.profileId);
    assert.deepEqual(
      linkedBrainProgramToJson(decoded.program),
      leanNormalize(envelope.program, profile.numberPrecision)
    );

    // (4) Per-section byte breakdown.
    const report = binaryProgramByteReport(stream.byteArrayFromUint8Array(new Uint8Array(committed)));
    const breakdown = report.sections.map((s) => `${s.tag}=${s.bodyBytes}`).join(" ");
    console.log(
      `[${golden.name}] total=${report.totalBytes}B magic=${report.magicBytes}B header=${report.headerBytes}B | ${breakdown}`
    );
  });

  test(`the ${golden.name} golden carries no typeId strings`, () => {
    const jsonPath = fixturePath(`${golden.name}.mcprogram`);
    const envelope = JSON.parse(readFileSync(jsonPath, "utf8")) as ProgramImageEnvelopeJson;
    // TypeId strings have the shape `<nativeType>:<...>`; type identity must
    // travel only through the type table, never the constant string pool.
    for (const value of envelope.program.program.constantPools.strings) {
      assert.ok(!/^[a-z]+:<.*>$/.test(value), `constant string pool carries a typeId string: ${value}`);
    }
  });
}
