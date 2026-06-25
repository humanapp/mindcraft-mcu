/**
 * Golden observable trace for a hand-authored brain that exercises the buffer
 * value type and its builtin host functions. One root rule constructs three
 * buffers - from a number list, from a hex string, and from a latin1 string -
 * reads each back through length() and get(i), and dispatches the display
 * set-pixel host action with the read scalars plus the buffer itself, so a
 * buffer value crosses the observable host-binding surface and renders as a
 * `buffer <hex>` token. The serialized binary and its rendered trace are pinned
 * beside this spec as the cross-VM buffer conformance fixture: the C++ VM parity
 * test (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreFuncId,
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

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/buffer-ops.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/buffer-ops.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices.
const N10 = 0;
const N20 = 1;
const N30 = 2;
const N_IDX1 = 3; // the value 1 (get index)
const N_IDX0 = 4; // the value 0 (get index)

// String constant-pool indices.
const S_HEX = 0; // "00ff7f"
const S_HI = 1; // "Hi"

// Value constant-pool index of the nil placeholder (the function's return value).
const NIL = 0;

// Local slots.
const L_LIST = 0;
const L_BUF_LIST = 1;
const L_BUF_HEX = 2;
const L_BUF_STR = 3;

/**
 * Surfaces one buffer in local `bufLocal`: dispatches set-pixel with x =
 * length(), y = get(getIdx), and the buffer itself as the brightness arg, so the
 * buffer renders as a value token in the trace.
 */
function surfaceBuffer(bufLocal: number, getIdx: number) {
  return [
    { op: Op.LOAD_LOCAL, a: bufLocal },
    { op: Op.HOST_CALL, a: CoreFuncId.BufferLength, b: 1, c: 0 }, // x = length()
    { op: Op.LOAD_LOCAL, a: bufLocal },
    { op: Op.PUSH_CONST_NUM, a: getIdx },
    { op: Op.HOST_CALL, a: CoreFuncId.BufferGet, b: 2, c: 0 }, // y = get(i)
    { op: Op.LOAD_LOCAL, a: bufLocal }, // brightness arg = the buffer value
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];
}

/** Builds local `listLocal` as the number list `[10, 20, 30]`. */
function buildList(listLocal: number) {
  return [
    { op: Op.LIST_NEW, a: 0 },
    { op: Op.STORE_LOCAL, a: listLocal },
    { op: Op.LOAD_LOCAL, a: listLocal },
    { op: Op.PUSH_CONST_NUM, a: N10 },
    { op: Op.LIST_PUSH },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: listLocal },
    { op: Op.PUSH_CONST_NUM, a: N20 },
    { op: Op.LIST_PUSH },
    { op: Op.POP },
    { op: Op.LOAD_LOCAL, a: listLocal },
    { op: Op.PUSH_CONST_NUM, a: N30 },
    { op: Op.LIST_PUSH },
    { op: Op.POP },
  ];
}

/**
 * One root rule that constructs a buffer from a list, from a hex string, and
 * from a latin1 string, then surfaces each through display set-pixel.
 */
function buildBufferBrainJson(): LinkedBrainProgramJson {
  const code = [
    ...buildList(L_LIST),
    // buffer from list [10, 20, 30]
    { op: Op.LOAD_LOCAL, a: L_LIST },
    { op: Op.HOST_CALL, a: CoreFuncId.BufferFrom, b: 1, c: 0 },
    { op: Op.STORE_LOCAL, a: L_BUF_LIST },
    ...surfaceBuffer(L_BUF_LIST, N_IDX1), // length 3, get(1) -> 20, buffer 0a141e
    // buffer from hex "00ff7f"
    { op: Op.PUSH_CONST_STR, a: S_HEX },
    { op: Op.HOST_CALL, a: CoreFuncId.BufferFromHex, b: 1, c: 0 },
    { op: Op.STORE_LOCAL, a: L_BUF_HEX },
    ...surfaceBuffer(L_BUF_HEX, N_IDX1), // length 3, get(1) -> 255, buffer 00ff7f
    // buffer from string "Hi"
    { op: Op.PUSH_CONST_STR, a: S_HI },
    { op: Op.HOST_CALL, a: CoreFuncId.BufferFromString, b: 1, c: 0 },
    { op: Op.STORE_LOCAL, a: L_BUF_STR },
    ...surfaceBuffer(L_BUF_STR, N_IDX0), // length 2, get(0) -> 72, buffer 4869
    { op: Op.PUSH_CONST_VAL, a: NIL },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code, numParams: 0, numLocals: 4 }],
      constantPools: {
        numbers: [10, 20, 30, 1, 0],
        strings: ["00ff7f", "Hi"],
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
        pageId: "buffer-ops-page",
        pageName: "Buffer Ops",
        rootRuleFuncIds: [0],
        actionCallSites: [{ binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL }],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeBufferBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildBufferBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Runs the committed binary over a fixed tick schedule with the trace taps installed. */
function runBufferTrace(bin: Uint8Array): string {
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

test("the committed buffer-ops binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBufferBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeBufferBrainBytes(), "buffer-ops.mcprogram.bin is not byte-stable");

  const first = runBufferTrace(bin);
  const second = runBufferTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // Three buffers surfaced per tick, run thrice, each carrying a buffer token.
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 9);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 9);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(lines.filter((line) => line.includes(" buffer 0a141e ")).length, 3);
  assert.equal(lines.filter((line) => line.includes(" buffer 00ff7f ")).length, 3);
  assert.equal(lines.filter((line) => line.includes(" buffer 4869 ")).length, 3);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "buffer-ops.ticks.trace is not byte-stable");
});
