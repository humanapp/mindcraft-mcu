/**
 * Hand-constructed synthetic conformance fixture for the parent-quiescence
 * invariant: a parent rule does not re-fire while a child rule it spawned is
 * still in flight (parked awaiting). A real compile of a nested rule emits this
 * shape; the fixture pins the bytecode so the C++ VM parity test byte-compares
 * the same binary and trace.
 *
 * Golden observable trace for a brain whose root (parent) rule lights a marker
 * pixel (0,0) in its DO and spawns one child rule. The child lights pixel (1,0),
 * awaits an async bytecode action, then lights pixel (1,1). The parent's marker
 * appears on the think it fires and then stays silent for every think the child
 * is in flight (running, parked, and resuming); the parent fires its marker
 * again only after the child's whole lifecycle completes. The parent marker
 * (0,0) therefore appears far fewer times than there are thinks, and never in
 * the same think as the child's pixels.
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

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/parent-quiesce.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/parent-quiesce.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N0 = 0;
const N1 = 1;

// Value constant-pool index of the nil placeholder (each function's RET value).
const NIL = 0;

/** A display set-pixel surfaced as an observable marker: pixel (x, y) = 1. */
function setPixel(xIdx: number, yIdx: number, callSiteId: number) {
  return [
    { op: Op.PUSH_CONST_NUM, a: xIdx },
    { op: Op.PUSH_CONST_NUM, a: yIdx },
    { op: Op.PUSH_CONST_NUM, a: N1 },
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: callSiteId },
    { op: Op.POP },
  ];
}

/**
 * A root (parent) rule (funcId 0) whose DO lights pixel (0,0) and spawns one
 * child rule (funcId 1). The child lights pixel (1,0), awaits an async bytecode
 * action (funcId 2 via action slot 0), then lights pixel (1,1).
 */
function buildParentQuiesceBrainJson(): LinkedBrainProgramJson {
  const parent = [
    ...setPixel(N0, N0, 1),
    { op: Op.SPAWN_RULE, a: 1 },
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  const child = [
    ...setPixel(N1, N0, 2),
    { op: Op.ACTION_CALL_ASYNC, a: 0, b: 0, c: 3 },
    { op: Op.AWAIT },
    { op: Op.POP },
    ...setPixel(N1, N1, 4),
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  const asyncActionBody = [
    { op: Op.PUSH_CONST_NUM, a: N0 }, // resolved result: 0
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: parent, numParams: 0, numLocals: 0 },
        { code: child, numParams: 0, numLocals: 0 },
        { code: asyncActionBody, numParams: 0, numLocals: 0 },
      ],
      constantPools: { numbers: [0, 1], strings: [], values: [{ t: 1 }] },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [{ entryFuncId: 2 }],
      ruleFuncIds: [0, 1],
      ruleAncestors: [{ ruleFuncId: 1, parentRuleFuncId: 0 }],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "parent-quiesce-page",
        pageName: "Parent Quiesce",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 1, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 3, actionSlot: 0 },
          { binding: "host", callSiteId: 4, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  };
}

function serializeBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildParentQuiesceBrainJson());
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

test("the committed parent-quiesce binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeBrainBytes(), "parent-quiesce.mcprogram.bin is not byte-stable");

  const first = runTrace(bin, 8);
  const second = runTrace(bin, 8);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 8);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // Pixel x=0/y=0 is the parent marker (00000000 00000000); x=1 (3f800000) is
  // the child. The parent marker fires far fewer times than there are thinks.
  const PARENT = "port display set-pixel 00000000 00000000 ";
  const CHILD_X = "port display set-pixel 3f800000 ";
  const parentMarks = lines.filter((l) => l.startsWith(PARENT)).length;
  assert.ok(parentMarks > 0, "the parent must fire at least once");
  assert.ok(parentMarks < 8, "the parent must not re-fire every think while its child is in flight");

  // The invariant: there is a think whose block carries a child pixel but NOT
  // the parent marker, proving the parent quiesced while its child was live.
  const blocks = tickBlocks(first);
  const quiescedWhileChildLive = blocks.some(
    (block) => block.some((l) => l.startsWith(CHILD_X)) && !block.some((l) => l.startsWith(PARENT))
  );
  assert.ok(quiescedWhileChildLive, "the parent must not re-fire while its child rule is in flight");

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "parent-quiesce.ticks.trace is not byte-stable");
});
