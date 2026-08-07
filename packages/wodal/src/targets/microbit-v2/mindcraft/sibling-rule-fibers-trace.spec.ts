/**
 * Hand-constructed synthetic conformance fixture for the child-rule fiber model
 * (the `SPAWN_RULE` opcode). A real compile of nested rules emits this shape;
 * the fixture pins the bytecode so the C++ VM parity test byte-compares the same
 * binary and trace.
 *
 * Golden observable trace for a brain whose root rule spawns two child rules,
 * each of which dispatches an async bytecode action (ACTION_CALL_ASYNC + AWAIT)
 * and surfaces a display set-pixel before and after the await. Each child runs
 * in its own fiber, so the two children dispatch their async actions in the SAME
 * think: both "before" pixels land together, and one child's AWAIT does not park
 * the other. Each child resumes independently once its handle settles, surfacing
 * its "after" pixel. The two children are distinguished by the pixel x
 * coordinate (1 vs 2); y=0 marks the pre-await pixel and y=1 the post-resume
 * pixel.
 *
 * The serialized binary and its rendered trace are pinned beside this spec as
 * the cross-VM conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type LinkedBrainProgramJson, linkedBrainProgramFromJson, Op } from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/sibling-rule-fibers.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/sibling-rule-fibers.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N0 = 0;
const N1 = 1;
const N2 = 2;

// Value constant-pool index of the nil placeholder (each function's RET value).
const NIL = 0;

/** A display set-pixel surfaced as an observable marker: pixel (x, y) = brightness. */
function setPixel(xIdx: number, yIdx: number, brightnessIdx: number, callSiteId: number) {
  return [
    { op: Op.PUSH_CONST_NUM, a: xIdx },
    { op: Op.PUSH_CONST_NUM, a: yIdx },
    { op: Op.PUSH_CONST_NUM, a: brightnessIdx },
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: callSiteId },
    { op: Op.POP },
  ];
}

/**
 * A child rule (funcId 1 or 2): surface a pre-await pixel at y=0, await an async
 * bytecode action, then surface a post-resume pixel at y=1. `x` distinguishes
 * the two children; `actionSlot` selects this child's async action body.
 */
function childRule(xIdx: number, actionSlot: number, beforeCs: number, asyncCs: number, afterCs: number) {
  return [
    ...setPixel(xIdx, N0, N1, beforeCs),
    { op: Op.ACTION_CALL_ASYNC, a: actionSlot, b: 0, c: asyncCs },
    { op: Op.AWAIT },
    { op: Op.POP }, // discard the resolved action result
    ...setPixel(xIdx, N1, N2, afterCs),
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];
}

/**
 * A root rule (funcId 0) that spawns two child rules (funcIds 1 and 2), each
 * awaiting an async bytecode action (funcIds 3 and 4 via action slots 0 and 1).
 * The async action bodies return a number, settling the handle each child
 * awaits.
 */
function buildSiblingRuleFibersBrainJson(): LinkedBrainProgramJson {
  const rootRule = [
    { op: Op.SPAWN_RULE, a: 1 },
    { op: Op.SPAWN_RULE, a: 2 },
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  const child1 = childRule(N1, 0, 10, 11, 12);
  const child2 = childRule(N2, 1, 20, 21, 22);

  const asyncActionBody = [
    { op: Op.PUSH_CONST_NUM, a: N0 }, // resolved result: 0
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: rootRule, numParams: 0, numLocals: 0 },
        { code: child1, numParams: 0, numLocals: 0 },
        { code: child2, numParams: 0, numLocals: 0 },
        { code: asyncActionBody, numParams: 0, numLocals: 0 },
        { code: asyncActionBody, numParams: 0, numLocals: 0 },
      ],
      constantPools: { numbers: [0, 1, 2], strings: [], values: [{ t: 1 }] },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [{ entryFuncId: 3 }, { entryFuncId: 4 }],
      ruleFuncIds: [0, 1, 2],
      ruleAncestors: [
        { ruleFuncId: 1, parentRuleFuncId: 0 },
        { ruleFuncId: 2, parentRuleFuncId: 0 },
      ],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "sibling-rule-fibers-page",
        pageName: "Sibling Rule Fibers",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 10, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 11, actionSlot: 0 },
          { binding: "host", callSiteId: 12, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 20, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 21, actionSlot: 1 },
          { binding: "host", callSiteId: 22, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  };
}

function serializeBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildSiblingRuleFibersBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace observers and display tap installed. */
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

/** Splits a rendered trace into per-tick blocks keyed by the `tick N` header. */
function tickBlocks(trace: string): string[][] {
  const blocks: string[][] = [];
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      blocks.push([]);
    } else if (blocks.length > 0 && line.length > 0) {
      blocks[blocks.length - 1]!.push(line);
    }
  }
  return blocks;
}

test("the committed sibling-rule-fibers binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeBrainBytes(), "sibling-rule-fibers.mcprogram.bin is not byte-stable");

  const first = runTrace(bin, 6);
  const second = runTrace(bin, 6);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 6);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // Coordinates render as f32 hex: x=1 and y=1 are 3f800000, x=2 is 40000000,
  // y=0 is 00000000. child1 uses x=1, child2 uses x=2; y=0 is the pre-await
  // pixel, y=1 the post-resume pixel.
  const X1 = "3f800000";
  const X2 = "40000000";
  const Y0 = "00000000";
  const Y1 = "3f800000";

  // The core fix: both siblings dispatch in the same think. A tick block carries
  // BOTH children's pre-await pixels (x=1 and x=2 at y=0), proving one sibling's
  // AWAIT did not park the other.
  const blocks = tickBlocks(first);
  const hasConcurrentPreAwait = blocks.some(
    (block) =>
      block.some((l) => l.startsWith(`port display set-pixel ${X1} ${Y0} `)) &&
      block.some((l) => l.startsWith(`port display set-pixel ${X2} ${Y0} `))
  );
  assert.ok(hasConcurrentPreAwait, "both child rules must dispatch their async action in the same think");

  // Both children also resume independently: a tick carries both post-resume
  // pixels (x=1 and x=2 at y=1).
  const hasConcurrentPostResume = blocks.some(
    (block) =>
      block.some((l) => l.startsWith(`port display set-pixel ${X1} ${Y1} `)) &&
      block.some((l) => l.startsWith(`port display set-pixel ${X2} ${Y1} `))
  );
  assert.ok(hasConcurrentPostResume, "both child rules must resume after their await");

  // Symmetry: the two children produce the same number of pixels.
  const child1Pixels = lines.filter((l) => l.startsWith(`port display set-pixel ${X1} `)).length;
  const child2Pixels = lines.filter((l) => l.startsWith(`port display set-pixel ${X2} `)).length;
  assert.equal(child1Pixels, child2Pixels);
  assert.ok(child1Pixels > 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "sibling-rule-fibers.ticks.trace is not byte-stable");
});
