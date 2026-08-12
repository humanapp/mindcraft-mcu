/**
 * Hand-constructed synthetic conformance fixture, not recreatable from a real
 * compile: it relies on per-callsite action lifecycle hooks and rules that issue
 * several surfacing calls in one body, neither of which the brain compiler emits
 * (a rule's do() compiles a single action).
 *
 * Golden observable trace for a hand-authored two-page brain that exercises the
 * bytecode-action calling convention, per-callsite state, and the page
 * lifecycle. Each page's root rule calls a sync bytecode action that surfaces
 * its persistent call-site slot, then stores the call argument back into that
 * slot; the action's initializer, activation, and deactivation hooks each
 * surface a distinct marker. A page change deactivates the old page and
 * activates the new one; changing back shows the activation hook re-running
 * while the once-only initializer does not, and the call-site slot surviving
 * the round trip. Markers ride in the display brightness arg so the control
 * flow is observable. The serialized binary and its rendered trace are pinned
 * beside this spec as the cross-VM conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type PlatformServices,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/action-page-lifecycle.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/action-page-lifecycle.ticks.trace", import.meta.url));

const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

// Number constant-pool indices. The persistent-slot seeds and lifecycle markers
// ride in the display brightness arg, leaving the x/y coordinates at the origin.
const N0 = 0;
const N_SEED_0 = 1; // page-0 action call-site slot seed
const N_SEED_1 = 2; // page-1 action call-site slot seed
const N_INIT_0 = 3;
const N_ACT_0 = 4;
const N_DEACT_0 = 5;
const N_INIT_1 = 6;
const N_ACT_1 = 7;
const N_DEACT_1 = 8;
const N_ARG_0 = 9; // page-0 action call argument
const N_ARG_1 = 10; // page-1 action call argument

/**
 * A two-page brain. Each page has one root rule that calls a sync bytecode
 * action; each action surfaces its call-site slot, stores its argument back,
 * and carries initializer/activation/deactivation hooks that surface markers.
 */
function buildActionPageLifecycleBrainJson(): LinkedBrainProgramJson {
  const setPixelConst = (markerIdx: number) => [
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.PUSH_CONST_NUM, a: markerIdx },
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];

  // Surfaces the action's call-site slot 0 through display brightness.
  const setPixelFromSlot = [
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.PUSH_CONST_NUM, a: N0 },
    { op: Op.LOAD_CALLSITE_VAR, a: 0 },
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 0 },
    { op: Op.POP },
  ];

  const rule = (actionSlot: number, callSiteId: number, argIdx: number) => [
    { op: Op.PUSH_CONST_NUM, a: argIdx },
    { op: Op.ACTION_CALL, a: actionSlot, b: 1, c: callSiteId },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  // Surfaces the prior slot value, then stores this call's argument (local 0).
  const actionBody = [
    ...setPixelFromSlot,
    { op: Op.LOAD_LOCAL, a: 0 },
    { op: Op.STORE_CALLSITE_VAR, a: 0 },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  // Seeds the call-site slot once, then surfaces the initializer marker.
  const initializer = (seedIdx: number, markerIdx: number) => [
    { op: Op.PUSH_CONST_NUM, a: seedIdx },
    { op: Op.STORE_CALLSITE_VAR, a: 0 },
    ...setPixelConst(markerIdx),
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  const hook = (markerIdx: number) => [...setPixelConst(markerIdx), { op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }];

  return {
    program: {
      version: 1,
      functions: [
        { code: rule(0, 1, N_ARG_0), numParams: 0, numLocals: 0 }, // 0: page-0 rule
        { code: actionBody, numParams: 1, numLocals: 1 }, // 1: action slot 0 body
        { code: initializer(N_SEED_0, N_INIT_0), numParams: 0, numLocals: 0 }, // 2
        { code: hook(N_ACT_0), numParams: 0, numLocals: 0 }, // 3: activation
        { code: hook(N_DEACT_0), numParams: 0, numLocals: 0 }, // 4: deactivation
        { code: rule(1, 2, N_ARG_1), numParams: 0, numLocals: 0 }, // 5: page-1 rule
        { code: actionBody, numParams: 1, numLocals: 1 }, // 6: action slot 1 body
        { code: initializer(N_SEED_1, N_INIT_1), numParams: 0, numLocals: 0 }, // 7
        { code: hook(N_ACT_1), numParams: 0, numLocals: 0 }, // 8: activation
        { code: hook(N_DEACT_1), numParams: 0, numLocals: 0 }, // 9: deactivation
      ],
      constantPools: {
        numbers: [0, 7, 8, 10, 11, 12, 20, 21, 22, 42, 43],
        strings: [],
        values: [{ t: 1 }],
      },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [
        { entryFuncId: 1, initializerFuncId: 2, activationFuncId: 3, deactivationFuncId: 4 },
        { entryFuncId: 6, initializerFuncId: 7, activationFuncId: 8, deactivationFuncId: 9 },
      ],
      ruleFuncIds: [0, 5],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "lifecycle-page-0",
        pageName: "Lifecycle Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 1, actionSlot: 0 },
        ],
      },
      {
        pageIndex: 1,
        pageId: "lifecycle-page-1",
        pageName: "Lifecycle Page 1",
        rootRuleFuncIds: [5],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: DISPLAY_SET_PIXEL },
          { binding: "bytecode", callSiteId: 2, actionSlot: 1 },
        ],
      },
    ],
  };
}

/** Serializes the hand-authored brain to its binary `.mcprogram` payload. */
function serializeActionPageLifecycleBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(buildActionPageLifecycleBrainJson());
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Runs the committed binary over a fixed tick schedule with two page changes
 * and the trace observers installed. The page is switched to page 1 before tick 3
 * and back to page 0 before tick 4.
 */
function runActionPageLifecycleTrace(bin: Uint8Array): string {
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

  // Page index requested before each tick; -1 leaves the current page in place.
  const requestedPage = [-1, -1, 1, 0];
  let lastThinkTimeMs = 0;
  for (let i = 0; i < requestedPage.length; i++) {
    if (requestedPage[i] >= 0) {
      brain.requestPageChange(requestedPage[i]);
    }
    const timeMs = lastThinkTimeMs + 16;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    brain.think(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

test("the committed action-page-lifecycle binary and observable trace golden are byte-stable", () => {
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeActionPageLifecycleBrainBytes());
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(
    bin,
    serializeActionPageLifecycleBrainBytes(),
    "action-page-lifecycle.mcprogram.bin is not byte-stable"
  );

  const first = runActionPageLifecycleTrace(bin);
  const second = runActionPageLifecycleTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 4);
  // Startup runs page-0 init + activation (2); tick 1 and tick 2 each run the
  // action once (2); the page-1 change runs page-0 deactivation + page-1 init +
  // activation + the page-1 action (4); the page-0 change runs page-1
  // deactivation + page-0 activation (no re-init) + the page-0 action (3).
  // Eleven host-action dispatches, no faults.
  assert.equal(lines.filter((line) => line.startsWith("action 401 ")).length, 11);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "action-page-lifecycle.ticks.trace is not byte-stable");
});
