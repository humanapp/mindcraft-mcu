/**
 * Golden observable trace for a brain that reads a Number variable nobody has
 * written yet, in the counting shape a beginner writes: WHEN count is under 3,
 * DO light a pixel and add one to count.
 *
 * The variable slot carries a starting value of 0 in the program's `VARS`
 * section, so the first `LOAD_VAR_SLOT` observes 0 and the WHEN comparison is
 * true from the first tick. The rule fires on three consecutive ticks, lighting
 * a pixel whose x coordinate is the count it read (0, 1, 2), and stops once
 * count reaches 3.
 *
 * The serialized binary and its rendered trace are pinned beside this spec as
 * the cross-VM zero-init conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreFuncId,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  NativeType,
  Op,
} from "@wendoo/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/variable-zero-init.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/variable-zero-init.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N_LIMIT = 0; // 3, the comparison bound
const N_STEP = 1; // 1, both the increment and the pixel brightness
const N_ZERO = 2; // 0, the pixel y coordinate

// Value constant-pool indices.
const V_ZERO = 0; // the variable's starting value
const V_NIL = 1; // the function's RET value

// The single brain variable slot.
const SLOT_COUNT = 0;

// Host call-site ids.
const CS_LESS_THAN = 10;
const CS_ADD = 11;
const CS_PIXEL = 12;

/**
 * A one-rule brain: `WHEN count < 3 DO set-pixel(count, 0, 1); count = count + 1`.
 * Nothing writes `count` before the first read, so the rule's behavior is
 * decided entirely by the slot's starting value.
 */
function buildZeroInitBrainJson(): LinkedBrainProgramJson {
  const rule = [
    /*  0 */ { op: Op.WHEN_START },
    // count < 3
    /*  1 */ { op: Op.LOAD_VAR_SLOT, a: SLOT_COUNT },
    /*  2 */ { op: Op.PUSH_CONST_NUM, a: N_LIMIT },
    /*  3 */ { op: Op.HOST_CALL, a: CoreFuncId.OpLessThanNumber, b: 2, c: CS_LESS_THAN },
    // Falsy skips the whole DO block, landing on the function's return value.
    /*  4 */ { op: Op.WHEN_END, a: 12 },
    /*  5 */ { op: Op.DO_START },
    // Light a pixel at (count, 0), making each firing observable and carrying
    // the count it read.
    /*  6 */ { op: Op.LOAD_VAR_SLOT, a: SLOT_COUNT },
    /*  7 */ { op: Op.PUSH_CONST_NUM, a: N_ZERO },
    /*  8 */ { op: Op.PUSH_CONST_NUM, a: N_STEP },
    /*  9 */ { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: CS_PIXEL },
    /* 10 */ { op: Op.POP },
    // count = count + 1
    /* 11 */ { op: Op.LOAD_VAR_SLOT, a: SLOT_COUNT },
    /* 12 */ { op: Op.PUSH_CONST_NUM, a: N_STEP },
    /* 13 */ { op: Op.HOST_CALL, a: CoreFuncId.OpAddNumber, b: 2, c: CS_ADD },
    /* 14 */ { op: Op.STORE_VAR_SLOT, a: SLOT_COUNT },
    /* 15 */ { op: Op.DO_END },
    /* 16 */ { op: Op.PUSH_CONST_VAL, a: V_NIL },
    /* 17 */ { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: {
        numbers: [3, 1, 0],
        strings: [],
        values: [{ t: NativeType.Number, v: 0 }, { t: NativeType.Nil }],
      },
      types: [],
      variableNames: ["count"],
      variableInitValues: [V_ZERO],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "variable-zero-init-page",
        pageName: "Variable Zero Init",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: CS_PIXEL, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

function serializeBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildZeroInitBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the display tap installed. */
function runTrace(bin: Uint8Array, tickCount: number): string {
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
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + 16;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(16);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

test("the committed variable-zero-init binary and observable trace golden are byte-stable", () => {
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeBrainBytes(), "variable-zero-init.mcprogram.bin is not byte-stable");

  const first = runTrace(bin, 6);
  const second = runTrace(bin, 6);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 6);
  const faults = lines.filter((line) => line.startsWith("fault "));
  assert.deepEqual(faults, [], "the brain must run fault-free");

  // The rule fires exactly three times: the unwritten slot reads 0, so the
  // comparison holds from the first tick and stops once count reaches 3.
  const pixels = lines.filter((line) => line.startsWith("port display set-pixel "));
  assert.equal(pixels.length, 3, "count must run 0, 1, 2 and then stop");

  // Each firing lights the pixel at x = the count it read: 0, 1, then 2, as f32 hex.
  const xCoordinates = pixels.map((line) => line.split(" ")[3]);
  assert.deepEqual(xCoordinates, ["00000000", "3f800000", "40000000"]);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "variable-zero-init.ticks.trace is not byte-stable");
});
