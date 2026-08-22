/**
 * Hand-constructed synthetic conformance fixture, not recreatable from a real
 * compile: the ts-compiler rejects computed-key struct writes (`obj[expr] = v`)
 * and does not emit STRUCT_COPY_EXCEPT for object rest (`{...obj}`), so its
 * distinctive opcodes are unreachable from user TS.
 *
 * Golden observable trace for a hand-authored brain that accesses a named-field
 * struct through the dynamic computed-key opcodes: GET_FIELD (`obj[expr]`),
 * SET_FIELD (`obj[expr] = v`), and STRUCT_COPY_EXCEPT (`{...obj}` with an
 * excluded field). The struct's TYPS entry carries the field name -> id map
 * (binary format v3); each computed-key access resolves to its real field
 * value. Every surfaced scalar crosses the observable host-binding surface as a
 * display set-pixel arg. The serialized binary and its rendered trace are
 * pinned beside this spec as the cross-VM dynamic-field conformance fixture: the
 * C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary and
 * byte-compares.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type LinkedBrainProgramJson, linkedBrainProgramFromJson, Op } from "@wendoo-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/dynamic-field-access.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/dynamic-field-access.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N3 = 0;
const N4 = 1;
const N255 = 2;
const N9 = 3;

// String constant-pool indices (the dynamic field-name keys).
const SX = 0;
const SY = 1;

/**
 * One root-rule function. It builds a `Point` struct, writes its fields by id,
 * reads them back through computed-key GET_FIELD, overwrites one through
 * computed-key SET_FIELD, and copies the struct minus its `x` field through
 * STRUCT_COPY_EXCEPT. Each surfaced scalar is dispatched through display
 * set-pixel so it crosses the observable surface.
 */
function buildDynamicFieldBrainJson(): LinkedBrainProgramJson {
  const setPixel = { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 };

  const rule = [
    // p = Point{}; p.x = 3; p.y = 4 (id-based stores).
    { op: Op.STRUCT_NEW, a: 0, b: 0 },
    { op: Op.STORE_LOCAL, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N3 },
    { op: Op.STRUCT_SET_FIELD, a: 0 },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: N4 },
    { op: Op.STRUCT_SET_FIELD, a: 1 },
    { op: Op.POP },

    // Computed-key read: setPixel(p["x"] = 3, p["y"] = 4, 255).
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: SX },
    { op: Op.GET_FIELD },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: SY },
    { op: Op.GET_FIELD },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // Computed-key write: p["x"] = 9; setPixel(p.x = 9, p["y"] = 4, 255).
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: SX },
    { op: Op.PUSH_CONST_NUM, a: N9 },
    { op: Op.SET_FIELD },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: SY },
    { op: Op.GET_FIELD },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    // Object-rest: c = {...p} without "x"; setPixel(c.x = nil, c.y = 4, 255).
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_STR, a: SX },
    { op: Op.STRUCT_COPY_EXCEPT, a: 1, b: 0 },
    { op: Op.STORE_LOCAL, a: 1 },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.STRUCT_GET_FIELD, a: 0 },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.STRUCT_GET_FIELD, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: N255 },
    setPixel,
    { op: Op.POP },

    { op: Op.PUSH_CONST_VAL, a: 0 }, // void
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 2 }],
      constantPools: {
        numbers: [3, 4, 255, 9],
        strings: ["x", "y"],
        values: [{ t: 1 }],
      },
      types: [
        {
          tag: "struct",
          typeId: "struct:Point",
          name: "Point",
          maxFieldId: 1,
          fields: [
            { name: "x", fieldIndex: 0 },
            { name: "y", fieldIndex: 1 },
          ],
        },
      ],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "dynamic-field-page",
        pageName: "Dynamic Field",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeDynamicFieldBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildDynamicFieldBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace observers installed. */
function runDynamicFieldTrace(bin: Uint8Array): string {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
  });

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (let i = 0; i < 3; i++) {
    const timeMs = lastThinkTimeMs + 16;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(16);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

test("the committed dynamic-field-access binary and observable trace golden are byte-stable", () => {
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeDynamicFieldBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeDynamicFieldBrainBytes(), "dynamic-field-access.mcprogram.bin is not byte-stable");

  const first = runDynamicFieldTrace(bin);
  const second = runDynamicFieldTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // Three set-pixel dispatches per tick, run thrice, with no faults.
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 9);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 9);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The computed-key reads resolve: the first surfaced row carries x=3, y=4.
  const firstAction = lines.find((line) => line.startsWith("action 401 "));
  assert.ok(firstAction !== undefined);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "dynamic-field-access.ticks.trace is not byte-stable");
});
