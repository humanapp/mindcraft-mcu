/**
 * Hand-constructed synthetic negative fixture, not recreatable from a real
 * compile: it deliberately yields inside a sync action, which is illegal and
 * faults the fiber - a valid compile never emits it.
 *
 * Golden observable trace for a hand-authored brain that exercises the sync
 * bytecode-action suspension boundary. The root rule yields cooperatively (it
 * has no enclosing action frame, so the yield is legal and splits the rule
 * across a round boundary), then calls a sync bytecode action whose body
 * yields - which is illegal and faults the fiber. Each leg surfaces a distinct
 * marker through display set-pixel so the control flow is observable, and the
 * fault surfaces as a fault line. The serialized binary and its rendered trace
 * are pinned beside this spec as the cross-VM conformance fixture: the C++ VM
 * parity test (cpp/test/trace-parity.test.cpp) loads the same binary and
 * byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/sync-action-yield.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/sync-action-yield.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices. Markers ride in the brightness arg, leaving the
// x/y coordinates at the origin.
const N0 = 0;
const MARKER_RULE_BEFORE_YIELD = 1;
const MARKER_RULE_AFTER_YIELD = 2;
const MARKER_RULE_AFTER_ACTION = 3;
const MARKER_ACTION_BODY = 4;

/**
 * A root rule and one sync bytecode action. The rule surfaces a marker, yields
 * (legal: no action frame encloses it), surfaces a second marker on resume,
 * then calls the action. The action surfaces its own marker and yields, which
 * faults because a sync action cannot suspend; the rule's post-call marker is
 * never reached.
 */
function buildSyncActionYieldBrainJson(): LinkedBrainProgramJson {
  const setPixel = (markerIdx: number) => [
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.PUSH_CONST_NUM, a: markerIdx },
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];

  const rule = [
    ...setPixel(MARKER_RULE_BEFORE_YIELD),
    { op: Op.YIELD },
    ...setPixel(MARKER_RULE_AFTER_YIELD),
    { op: Op.ACTION_CALL, a: 0, b: 0, c: 1 },
    { op: Op.POP },
    ...setPixel(MARKER_RULE_AFTER_ACTION),
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  const action = [...setPixel(MARKER_ACTION_BODY), { op: Op.YIELD }, { op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }];

  return {
    program: {
      version: 1,
      functions: [
        { code: rule, numParams: 0, numLocals: 0 },
        { code: action, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [0, 1, 2, 3, 4],
        strings: [],
        values: [{ t: 1 }],
      },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [{ entryFuncId: 1 }],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "sync-action-yield-page",
        pageName: "Sync Action Yield",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 1, actionSlot: 0 },
        ],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeSyncActionYieldBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildSyncActionYieldBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace taps installed. */
function runSyncActionYieldTrace(bin: Uint8Array): string {
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

  const action = environment.brainServices.runtime.actions.getById(DISPLAY_SET_PIXEL);
  assert.ok(action !== undefined && action.binding === "host");
  const exec = action.execSync;
  assert.ok(exec !== undefined);
  action.execSync = (ctx, args) => {
    const result = exec(ctx, args);
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    writer.hostActionCall(DISPLAY_SET_PIXEL, callSiteId, args, result);
    return result;
  };

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents: VmEvents = {
    onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code),
  };
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

test("the committed sync-action-yield binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeSyncActionYieldBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeSyncActionYieldBrainBytes(), "sync-action-yield.mcprogram.bin is not byte-stable");

  const first = runSyncActionYieldTrace(bin);
  const second = runSyncActionYieldTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // tick 1 surfaces the pre-yield marker then yields; tick 2 resumes
  // (post-yield marker), calls the action (action-body marker), and the
  // action's yield faults the fiber; tick 3 respawns the faulted rule and
  // surfaces the pre-yield marker again before yielding. The post-action
  // marker is never reached: four set-pixel dispatches, one fault.
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 4);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 4);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 1);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "sync-action-yield.ticks.trace is not byte-stable");
});
