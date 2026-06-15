/**
 * Golden observable trace for a hand-authored list/map brain. The brain builds
 * a list and a map, exercises the container opcodes, type-guards the results,
 * and surfaces the computed scalars by dispatching the display set-pixel host
 * action. The serialized binary and its rendered trace are pinned beside this
 * spec as the cross-VM container conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
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

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/container-ops.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/container-ops.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// NativeType tag operands for TYPE_CHECK.
const TYPE_LIST = 6;

/**
 * One root-rule function: builds list `[10, 20, 30]` and map `{1: 4, 2: 2}`,
 * reads them back through the container opcodes, type-guards both handles, and
 * dispatches display set-pixel three times with the computed scalars so every
 * value crosses the observable host-binding surface.
 */
function buildContainerBrainJson(): LinkedBrainProgramJson {
  const setPixel = { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 };
  const code = [
    // local 0 = list; push 10, 20, 30
    { op: Op.LIST_NEW, a: 0 },
    { op: Op.STORE_LOCAL, a: 0 },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: 0 },
    { op: Op.LIST_PUSH },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: 1 },
    { op: Op.LIST_PUSH },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: 2 },
    { op: Op.LIST_PUSH },
    { op: Op.POP },
    // call A: x = len (3), y = get[1] (20), brightness = pop (30)
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.LIST_LEN },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.PUSH_CONST_NUM, a: 3 },
    { op: Op.LIST_GET },
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.LIST_POP },
    setPixel,
    { op: Op.POP },
    // local 1 = map; set 1->4, 2->2
    { op: Op.MAP_NEW, a: 0 },
    { op: Op.STORE_LOCAL, a: 1 },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 3 },
    { op: Op.PUSH_CONST_NUM, a: 4 },
    { op: Op.MAP_SET },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 5 },
    { op: Op.PUSH_CONST_NUM, a: 5 },
    { op: Op.MAP_SET },
    { op: Op.POP },
    // call B: x = get(1) (4), y = get(2) (2), brightness = has(2) (true)
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 3 },
    { op: Op.MAP_GET },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 5 },
    { op: Op.MAP_GET },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 5 },
    { op: Op.MAP_HAS },
    setPixel,
    { op: Op.POP },
    // call C: x = isList(list) (true), y = isList(map) (false), delete key 1,
    //          brightness = has(1) after delete (false)
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.TYPE_CHECK, a: TYPE_LIST },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.TYPE_CHECK, a: TYPE_LIST },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 3 },
    { op: Op.MAP_DELETE },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: 1 },
    { op: Op.PUSH_CONST_NUM, a: 3 },
    { op: Op.MAP_HAS },
    setPixel,
    { op: Op.POP },
    // return void
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code, numParams: 0, numLocals: 2 }],
      constantPools: { numbers: [10, 20, 30, 1, 4, 2], strings: [], values: [{ t: 1 }] },
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
        pageId: "container-ops-page",
        pageName: "Container Ops",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeContainerBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildContainerBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace taps installed. */
function runContainerTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
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
  return { trace: writer.render(), microbit };
}

test("the committed container-ops binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeContainerBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeContainerBrainBytes(), "container-ops.mcprogram.bin is not byte-stable");

  const first = runContainerTrace(bin);
  const second = runContainerTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  // Each of the three ticks runs the rule once, dispatching set-pixel three
  // times and writing three pixels, with no faults.
  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 9);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 9);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // Call C drives pixel (0,0) to full brightness through bool-typed args.
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "container-ops.ticks.trace is not byte-stable");
});
