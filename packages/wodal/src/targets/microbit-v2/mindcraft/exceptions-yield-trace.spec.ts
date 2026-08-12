/**
 * Hand-constructed synthetic conformance fixture, not recreatable from a real
 * compile: the ts-compiler rejects try/catch ("Unsupported statement") and a
 * cooperative yield is not a user-TS construct, so these control-flow opcodes are
 * unreachable from user TS.
 *
 * Golden observable trace for a hand-authored exceptions/yield brain. The root
 * rule exercises the three control-flow opcodes whose semantics the C++ VM
 * mirrors: a cooperative `YIELD` that splits the rule across a round
 * (tick) boundary, a `TRY`/`THROW` caught within the same frame, and a
 * `THROW` raised in a callee that unwinds across frames to a handler in the
 * rule. Each leg surfaces a distinct marker through display set-pixel so the
 * control flow is observable. The serialized binary and its rendered trace are
 * pinned beside this spec as the cross-VM exceptions/yield conformance fixture:
 * the C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary
 * and byte-compares.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type LinkedBrainProgramJson, linkedBrainProgramFromJson, Op } from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/exceptions-yield.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/exceptions-yield.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N0 = 0;
const N1 = 1;
const N2 = 2;
const N3 = 3;
const N4 = 4;
const N9 = 5;

/**
 * One root-rule function plus one callee. The rule surfaces marker 1, yields
 * (suspending until the next round), then surfaces marker 2; catches a
 * same-frame THROW and surfaces marker 3; catches a THROW raised in the callee
 * (unwinding across the callee frame) and surfaces marker 4. Each marker is a
 * `setPixel(marker, 0, 0)` so it crosses the observable surface.
 */
function buildExceptionsYieldBrainJson(): LinkedBrainProgramJson {
  const setPixel = (markerIdx: number) => [
    { op: Op.PUSH_CONST_NUM, a: markerIdx },
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];

  // func 0: the root rule. The TRY relative operands are offsets from the TRY
  // instruction index to the catch instruction index (the bytecode the linker
  // would emit); a THROW always pops the handler, so no END_TRY is needed on
  // these always-throwing paths.
  const rule = [
    // --- YIELD splits the rule across a round boundary ---
    ...setPixel(N1), // marker 1, then suspend
    { op: Op.YIELD },
    ...setPixel(N2), // marker 2, on resume in the next round

    // --- TRY/THROW caught in the same frame (catch is +3 from TRY) ---
    { op: Op.TRY, a: 3 },
    { op: Op.PUSH_CONST_NUM, a: N9 },
    { op: Op.THROW },
    { op: Op.POP }, // catch: drop the error value
    ...setPixel(N3),

    // --- THROW in a callee unwinds across its frame to this handler (+2) ---
    { op: Op.TRY, a: 2 },
    { op: Op.CALL, a: 1, b: 0 }, // func 1 throws
    { op: Op.POP }, // catch: drop the error value
    ...setPixel(N4),

    { op: Op.PUSH_CONST_VAL, a: 0 }, // void/nil
    { op: Op.RET },
  ];

  // func 1: raises an uncaught-here THROW that the rule's handler catches.
  const thrower = [{ op: Op.PUSH_CONST_NUM, a: N9 }, { op: Op.THROW }];

  return {
    program: {
      version: 1,
      functions: [
        { code: rule, numParams: 0, numLocals: 0 },
        { code: thrower, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [0, 1, 2, 3, 4, 9],
        strings: [],
        values: [{ t: 1 }],
      },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "exceptions-yield-page",
        pageName: "Exceptions Yield",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeExceptionsYieldBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildExceptionsYieldBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace observers installed. */
function runExceptionsYieldTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
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
  return { trace: writer.render(), microbit };
}

test("the committed exceptions-yield binary and observable trace golden are byte-stable", () => {
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeExceptionsYieldBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeExceptionsYieldBrainBytes(), "exceptions-yield.mcprogram.bin is not byte-stable");

  const first = runExceptionsYieldTrace(bin);
  const second = runExceptionsYieldTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // YIELD splits the rule: tick 1 surfaces marker 1 then yields; tick 2 resumes
  // (marker 2) and runs both caught-throw legs (markers 3, 4); tick 3 respawns
  // the completed rule and surfaces marker 1 again before yielding. Five
  // set-pixel dispatches total, with no faults (every THROW is caught).
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 5);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 5);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "exceptions-yield.ticks.trace is not byte-stable");
});
