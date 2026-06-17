/**
 * Golden observable trace for a hand-authored brain that awaits an asynchronous
 * display scroll. On page entry the single rule scrolls "hi", awaits the scroll
 * handle, and lights pixel (0,0) once the animation completes. The await parks
 * the rule for the scroll's full duration; the pixel write surfaces the resume
 * round, which is fixed by the pinned completion-time formula.
 *
 * The serialized binary and rendered trace are pinned beside this spec as the
 * cross-VM conformance fixtures: the C++ VM parity test loads the same binary
 * and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  CoreHostActions,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { scrollCompletionTimeMs } from "./display-scroll";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const ON_PAGE_ENTERED = CoreHostActions.OnPageEntered.actionId;
const DISPLAY_SCROLL = MicroBitV2HostActions.DisplayScroll.actionId;
const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll.ticks.trace", import.meta.url));

/** Text scrolled by the fixture brain. */
const SCROLL_TEXT = "hi";

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;

/**
 * A single-page brain whose rule, on page entry, scrolls "hi" and awaits the
 * scroll handle, then lights pixel (0,0). The on-page-entered sensor fires the
 * rule once; the await holds the rule until the scroll animation completes.
 */
function buildScrollBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 11 }, // skip to the trailing nil when not entered
    { op: Op.PUSH_CONST_STR, a: 0 }, // scroll text: "hi"
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DISPLAY_SCROLL, b: 1, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP }, // discard the resolved void
    { op: Op.PUSH_CONST_NUM, a: 0 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 0 }, // y = 0
    { op: Op.PUSH_CONST_NUM, a: 1 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: { numbers: [0, 255], strings: [SCROLL_TEXT], values: [{ t: 1 }] },
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
        pageId: "scroll-page-0",
        pageName: "Scroll Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DISPLAY_SCROLL },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
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

/**
 * Runs `bin` over `tickCount` thinks at {@link TICK_ADVANCE_MS} each, with the
 * trace taps installed: the on-page-entered and set-pixel sync actions, the
 * async scroll action, the scroll device port, and fiber faults. Drives the
 * display scroll animation after each think so completed handles resume on the
 * following think.
 */
function runScrollTrace(bin: Uint8Array, tickCount: number): { trace: string; microbit: MicroBit } {
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
  for (const actionId of [ON_PAGE_ENTERED, DISPLAY_SET_PIXEL]) {
    const action = actions.getById(actionId);
    assert.ok(action !== undefined && action.binding === "host");
    const exec = action.execSync;
    assert.ok(exec !== undefined);
    action.execSync = (ctx, args) => {
      const result = exec(ctx, args);
      const callSiteId = ctx.currentCallSiteId;
      assert.ok(callSiteId !== undefined);
      writer.hostActionCall(actionId, callSiteId, args, result);
      return result;
    };
  }

  const scrollAction = actions.getById(DISPLAY_SCROLL);
  assert.ok(scrollAction !== undefined && scrollAction.binding === "host");
  const execAsync = scrollAction.execAsync;
  assert.ok(execAsync !== undefined);
  scrollAction.execAsync = (ctx, args, handle) => {
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    execAsync(ctx, args, handle);
    writer.hostActionCallAsync(DISPLAY_SCROLL, callSiteId, args);
  };

  const microbit = new MicroBit();
  const deviceScrollText = microbit.display.scrollText.bind(microbit.display);
  microbit.display.scrollText = (text, durationMs, requestTime, onComplete) => {
    writer.displayScroll(text);
    deviceScrollText(text, durationMs, requestTime, onComplete);
  };
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

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + TICK_ADVANCE_MS;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    brain.think(timeMs);
    microbit.display.advanceScroll(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed display-scroll binary and observable trace golden are byte-stable", () => {
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, serializeBrainBytes(buildScrollBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, serializeBrainBytes(buildScrollBrainJson()), "display-scroll.mcprogram.bin is not byte-stable");

  // The scroll starts on tick 1 (time 1100) and completes one full duration
  // later; the awaiting rule resumes and lights the pixel on the first think
  // past the completion time.
  const completionTime = scrollCompletionTimeMs(TICK_ADVANCE_MS, SCROLL_TEXT.length, 120);
  const resumeTick = Math.floor(completionTime / TICK_ADVANCE_MS) + 2;

  const first = runScrollTrace(bin, resumeTick);
  const second = runScrollTrace(bin, resumeTick);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  // Action ids render as minimal lowercase hex in the trace.
  const scrollHex = (DISPLAY_SCROLL >>> 0).toString(16);
  const setPixelHex = (DISPLAY_SET_PIXEL >>> 0).toString(16);

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, resumeTick);
  // The scroll dispatches once, crossing the display port and awaiting.
  assert.equal(lines.filter((line) => line === `port display scroll "${SCROLL_TEXT}"`).length, 1);
  assert.equal(lines.filter((line) => new RegExp(`^action ${scrollHex} .+ async$`).test(line)).length, 1);
  // The rule resumes after the scroll and lights the pixel exactly once.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith(`action ${setPixelHex} `)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "display-scroll.ticks.trace is not byte-stable");
});
