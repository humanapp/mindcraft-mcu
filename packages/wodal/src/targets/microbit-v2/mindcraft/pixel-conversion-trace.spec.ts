/**
 * Golden observable trace pinning the f32 -> u8 conversion the display set-pixel
 * write applies at the device port. A rule writes pixels with a valid integer
 * coordinate, a fractional coordinate, an out-of-range coordinate, an
 * over-bright value, and a fractional brightness. The host-action line records
 * the raw arguments; the port line records the post-conversion value and is
 * emitted only when the coordinates cross (an exact integer in 0..255), so a
 * fractional or out-of-range coordinate produces no port line. The C++ VM
 * applies the identical conversion, so its trace byte-matches this golden
 * (cpp/test/trace-parity.test.cpp).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/pixel-conversion.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/pixel-conversion.ticks.trace", import.meta.url));

/**
 * A single-page brain whose rule writes five pixels: a valid integer coordinate,
 * a fractional x, an out-of-range x, an over-bright value, and a fractional
 * brightness. Each call crosses the port with its narrowed (int16 coord, uint8
 * brightness) arguments; the device stores only the coordinates inside the matrix.
 */
function buildPixelConversionBrainJson(): LinkedBrainProgramJson {
  const setPixel = (xIdx: number, yIdx: number, bIdx: number, callSiteId: number) => [
    { op: Op.PUSH_CONST_NUM, a: xIdx },
    { op: Op.PUSH_CONST_NUM, a: yIdx },
    { op: Op.PUSH_CONST_NUM, a: bIdx },
    { op: Op.HOST_ACTION_CALL, a: SET_PIXEL, b: 3, c: callSiteId },
    { op: Op.POP },
  ];

  const rule = [
    ...setPixel(0, 1, 2, 0), // (1, 2, 255): in matrix -> stores pixel (1, 2)
    ...setPixel(3, 1, 2, 1), // (1.5, 2, 255): coord truncates to 1 -> stores pixel (1, 2)
    ...setPixel(4, 1, 2, 2), // (300, 2, 255): coord crosses but is outside the matrix -> no store
    ...setPixel(6, 6, 4, 3), // (0, 0, 300): brightness wraps to 44 -> stores pixel (0, 0)
    ...setPixel(0, 0, 5, 4), // (1, 1, 100.9): brightness truncates to 100 -> stores pixel (1, 1)
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: { numbers: [1, 2, 255, 1.5, 300, 100.9, 0], strings: [], values: [{ t: 1 }] },
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
        pageId: "pixel-conversion-page",
        pageName: "Pixel Conversion Page",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: SET_PIXEL },
          { binding: "host", callSiteId: 1, actionId: SET_PIXEL },
          { binding: "host", callSiteId: 2, actionId: SET_PIXEL },
          { binding: "host", callSiteId: 3, actionId: SET_PIXEL },
          { binding: "host", callSiteId: 4, actionId: SET_PIXEL },
        ],
      },
    ],
  };
}

function serializeBrainBytes(json: LinkedBrainProgramJson): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(json);
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/** Runs `bin` for one 600ms think, tapping the set-pixel action and device port. */
function runTrace(bin: Uint8Array): string {
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

  const actions = environment.brainServices.runtime.actions;
  const action = actions.getById(SET_PIXEL);
  assert.ok(action !== undefined && action.binding === "host");
  const exec = action.execSync;
  assert.ok(exec !== undefined);
  action.execSync = (ctx, args) => {
    const result = exec(ctx, args);
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    writer.hostActionCall(SET_PIXEL, callSiteId, args, result);
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

  const linked = decoded.program;
  const brain = new BrainRuntime(
    linked.program,
    linked.pages,
    hostServicesOf(environment),
    { microbit },
    undefined,
    vmEvents,
    {
      defaultBudget: profile.defaultBudget,
      hookBudget: profile.hookBudget,
      maxFibers: profile.maxFibers,
      maxStackSize: profile.maxStackSize,
      maxLocalsSize: profile.maxLocalsSize,
      maxFrameDepth: profile.maxFrameDepth,
      maxHandlers: profile.maxHandlers,
    }
  );
  brain.startup();

  writer.tick(1, 600, 0);
  brain.think(600);
  return writer.render();
}

test("the committed pixel-conversion binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes(buildPixelConversionBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildPixelConversionBrainJson()),
    "pixel-conversion.mcprogram.bin is not byte-stable"
  );

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  // Five host-action calls, each crossing the port with its narrowed arguments.
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 5);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 5);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "pixel-conversion.ticks.trace is not byte-stable");
});
