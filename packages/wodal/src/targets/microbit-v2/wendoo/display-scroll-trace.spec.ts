/**
 * Hand-constructed synthetic conformance fixtures (display-scroll,
 * display-scroll-drop, managed-string-scroll), not recreatable from a real
 * compile: each rule dispatches the display-scroll tile action and then writes
 * a marker pixel (two actions in one rule, while the brain compiler emits one
 * action per rule).
 *
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
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WendooEnvironment } from "@wendoo/core/app";
import {
  BrainRuntime,
  CoreFuncId,
  CoreHostActions,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  Op,
  type PlatformServices,
} from "@wendoo/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { scrollCompletionTimeMs } from "./display-scroll";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const ON_PAGE_ENTERED = CoreHostActions.OnPageEntered.actionId;
const DISPLAY_SCROLL = MicroBitV2HostActions.DisplayScroll.actionId;
const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll.ticks.trace", import.meta.url));
const DROP_BIN_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll-drop.mcprogram.bin", import.meta.url));
const DROP_TRACE_PATH = fileURLToPath(new URL("./__fixtures__/display-scroll-drop.ticks.trace", import.meta.url));
const MANAGED_BIN_PATH = fileURLToPath(new URL("./__fixtures__/managed-string-scroll.mcprogram.bin", import.meta.url));
const MANAGED_TRACE_PATH = fileURLToPath(new URL("./__fixtures__/managed-string-scroll.ticks.trace", import.meta.url));

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
    { op: Op.PUSH_CONST_STR, a: 0 }, // display text: "hi"
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

function hostServicesOf(environment: WendooEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Runs `bin` over `tickCount` thinks at {@link TICK_ADVANCE_MS} each, with the
 * trace observers installed: the on-page-entered and set-pixel sync actions, the
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

  const microbit = new MicroBit();
  const deviceScrollText = microbit.display.scrollText.bind(microbit.display);
  microbit.display.scrollText = (text, durationMs, requestTime, onComplete) => {
    // A scroll dropped while the display is busy crosses no port and emits no line.
    if (!microbit.display.isBusy()) {
      writer.displayScroll(text);
    }
    deviceScrollText(text, durationMs, requestTime, onComplete);
  };
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
  if (shouldWriteGolden(BIN_PATH)) {
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

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "display-scroll.ticks.trace is not byte-stable");
});

/**
 * A scrolling brain whose text is a computed managed string: "h" and "i"
 * concatenated through the string-concat host function. The scroll body reads
 * the managed string's bytes, so the scrolled text is "hi" and the trace matches
 * the borrowed-string scroll.
 */
function buildManagedScrollBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 12 }, // skip to the trailing nil when not entered
    { op: Op.PUSH_CONST_STR, a: 0 }, // "h"
    { op: Op.PUSH_CONST_STR, a: 1 }, // "i"
    { op: Op.HOST_CALL, a: CoreFuncId.OpAddString, b: 2, c: 0 }, // "hi" (managed)
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
      constantPools: { numbers: [0, 255], strings: ["h", "i"], values: [{ t: 1 }] },
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

test("the committed managed-string-scroll binary and observable trace golden are byte-stable", () => {
  if (shouldWriteGolden(MANAGED_BIN_PATH)) {
    writeFileSync(MANAGED_BIN_PATH, serializeBrainBytes(buildManagedScrollBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(MANAGED_BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildManagedScrollBrainJson()),
    "managed-string-scroll.mcprogram.bin is not byte-stable"
  );

  const completionTime = scrollCompletionTimeMs(TICK_ADVANCE_MS, SCROLL_TEXT.length, 120);
  const resumeTick = Math.floor(completionTime / TICK_ADVANCE_MS) + 2;

  const first = runScrollTrace(bin, resumeTick);
  const second = runScrollTrace(bin, resumeTick);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  // The computed managed string scrolls the same "hi" the borrowed string does.
  assert.equal(lines.filter((line) => line === `port display scroll "${SCROLL_TEXT}"`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (shouldWriteGolden(MANAGED_TRACE_PATH)) {
    writeFileSync(MANAGED_TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(MANAGED_TRACE_PATH, "utf8"),
    first.trace,
    "managed-string-scroll.ticks.trace is not byte-stable"
  );
});

/**
 * A two-rule brain. Rule 0 scrolls "hi" and takes the display lease; rule 1,
 * running next in the same think, scrolls "yo". Because the lease is held, rule
 * 1's scroll is silently dropped -- it crosses no display port (no scroll line)
 * and its handle resolves on the next poll, so rule 1 lights pixel (4,0). Rule 0
 * resumes when its scroll completes and lights pixel (0,0).
 */
function buildConcurrentScrollBrainJson(): LinkedBrainProgramJson {
  const holder = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 10 }, // relative: skip to the trailing void push
    { op: Op.PUSH_CONST_STR, a: 0 }, // "hi"
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DISPLAY_SCROLL, b: 1, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 0 }, // y = 0
    { op: Op.PUSH_CONST_NUM, a: 1 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const competitor = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 3 },
    { op: Op.JMP_IF_FALSE, a: 10 }, // relative: skip to the trailing void push
    { op: Op.PUSH_CONST_STR, a: 1 }, // "yo"
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DISPLAY_SCROLL, b: 1, c: 4 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 2 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 0 }, // y = 0
    { op: Op.PUSH_CONST_NUM, a: 1 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 5 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: holder, numParams: 0, numLocals: 0 },
        { code: competitor, numParams: 0, numLocals: 0 },
      ],
      constantPools: { numbers: [0, 255, 4], strings: ["hi", "yo"], values: [{ t: 1 }] },
      types: [],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "scroll-page-0",
        pageName: "Scroll Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DISPLAY_SCROLL },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 3, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 4, actionId: DISPLAY_SCROLL },
          { binding: "host", callSiteId: 5, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  };
}

test("a scroll dispatched while the lease is held is silently dropped", () => {
  if (shouldWriteGolden(DROP_BIN_PATH)) {
    writeFileSync(DROP_BIN_PATH, serializeBrainBytes(buildConcurrentScrollBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(DROP_BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildConcurrentScrollBrainJson()),
    "display-scroll-drop.mcprogram.bin is not byte-stable"
  );

  const completionTime = scrollCompletionTimeMs(TICK_ADVANCE_MS, SCROLL_TEXT.length, 120);
  const resumeTick = Math.floor(completionTime / TICK_ADVANCE_MS) + 2;

  const first = runScrollTrace(bin, resumeTick);
  const second = runScrollTrace(bin, resumeTick);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  // Only the holder's scroll crosses the port; the competitor's is dropped.
  assert.equal(lines.filter((line) => line.startsWith("port display scroll ")).length, 1);
  assert.equal(lines.filter((line) => line === `port display scroll "${SCROLL_TEXT}"`).length, 1);
  assert.equal(lines.filter((line) => line === 'port display scroll "yo"').length, 0);
  // Both rules dispatch a scroll, so two async scroll lines appear.
  assert.equal(lines.filter((line) => /^action 402 .+ async$/.test(line)).length, 2);
  // The holder resumed after its scroll and lit (0,0); the scroll animation has
  // ended, so nothing overwrites it.
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (shouldWriteGolden(DROP_TRACE_PATH)) {
    writeFileSync(DROP_TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(DROP_TRACE_PATH, "utf8"),
    first.trace,
    "display-scroll-drop.ticks.trace is not byte-stable"
  );
});
