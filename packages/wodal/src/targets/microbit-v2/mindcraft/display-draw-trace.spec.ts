/**
 * Golden observable traces for hand-authored brains that paste an `Image` to the
 * display through the asynchronous draw-image actuator. Three fixtures pin the
 * display-lease behavior:
 *
 * - fire-and-forget: a zero-duration draw paints, takes no lease, and resolves
 *   at dispatch; the awaited handle is already settled, so the rule continues in
 *   the same think without ever holding the display.
 * - timed: a positive-duration draw holds the display lease for its duration;
 *   the rule parks on the awaited handle and resumes on the first think past the
 *   hold, then lights a marker pixel.
 * - dropped: two rules dispatch in one think; the first takes a timed lease and
 *   parks, so the second's draw is silently dropped -- it emits its async
 *   dispatch line but no display-port line (nothing is pasted), resolves at
 *   dispatch, and the second rule continues in the same think.
 *
 * The `Image` is a struct constant baked into each brain (a `Buffer` pixels
 * field carrying raw 0-255 bytes). Each serialized binary and rendered trace is
 * pinned beside this spec; the C++ VM parity test loads the same binary and
 * byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BrainTileLiteralDef,
  CoreTypeIds,
  type IBrainRuleDef,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainRuntime,
  CoreHostActions,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  NativeType,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes, serializeWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { WODAL_SHARED_TYPE_IDS, WodalSharedTypeAtomId } from "../../../mindcraft/shared-type-ids";
import { MicroBit } from "../microbit";
import { builtInImageHex, builtInImageTileId, getBuiltInImage } from "./built-in-images";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { MicroBitV2HostActions, WodalMicroBitV2ParameterId } from "./tile-ids";

const ON_PAGE_ENTERED = CoreHostActions.OnPageEntered.actionId;
const DRAW_IMAGE = MicroBitV2HostActions.DrawImage.actionId;
const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 100;

/** Hold of the timed draw fixtures, in seconds, as the draw-image duration argument. */
const HOLD_SECONDS = 0.25;

/** The hold the duration argument converts to, in milliseconds (a clean multiple of the tick advance). */
const HOLD_MS = HOLD_SECONDS * 1000;

/** A 5x5 image whose top row is full brightness and the rest is off. */
const IMAGE_WIDTH = 5;
const IMAGE_HEIGHT = 5;
const TOP_ROW_PIXELS_HEX = `ffffffffff${"00".repeat(20)}`;

/** A 5x5 image whose left column is full brightness, used by the dropped competitor. */
const LEFT_COL_PIXELS_HEX = ["ff", "00", "00", "00", "00"].join("").repeat(5);

/** Baked `Image` struct constant carrying `pixelsHex` as its packed pixel buffer. */
function imageConstant(pixelsHex: string): unknown {
  return {
    t: NativeType.Struct,
    typeId: WODAL_SHARED_TYPE_IDS.Image,
    v: [
      { t: NativeType.Number, v: IMAGE_WIDTH },
      { t: NativeType.Number, v: IMAGE_HEIGHT },
      { t: NativeType.Buffer, v: pixelsHex },
    ],
  };
}

/** TYPS atom entry resolving the baked `Image` constants to the registered type. */
const IMAGE_TYPE_ENTRY = {
  tag: "atom",
  typeId: WODAL_SHARED_TYPE_IDS.Image,
  atomId: WodalSharedTypeAtomId.Image,
};

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
 * Runs `bin` over `tickCount` thinks at {@link TICK_ADVANCE_MS} each with the
 * trace taps installed: the on-page-entered and set-pixel sync actions, the
 * async draw-image action, and the display draw / set-pixel ports. A draw port
 * line is emitted for each frame the display paints -- one at dispatch and one
 * per sequence advance -- and a dropped draw paints nothing, mirroring the C++
 * parity tap. Drives the display poll after each think so a timed draw's hold
 * settles and the awaiting fiber resumes on the next think.
 */
function runDrawTrace(
  bin: Uint8Array,
  tickCount: number,
  tickMs: number = TICK_ADVANCE_MS
): { trace: string; microbit: MicroBit } {
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

  const drawAction = actions.getById(DRAW_IMAGE);
  assert.ok(drawAction !== undefined && drawAction.binding === "host");
  const execAsync = drawAction.execAsync;
  assert.ok(execAsync !== undefined);
  drawAction.execAsync = (ctx, args, handle) => {
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    execAsync(ctx, args, handle);
    writer.hostActionCallAsync(DRAW_IMAGE, callSiteId, args);
  };

  const microbit = new MicroBit();
  const devicePaintFrame = microbit.display.paintFrame.bind(microbit.display);
  microbit.display.paintFrame = (image) => {
    writer.displayDraw(image.width, image.height, image.frame);
    devicePaintFrame(image);
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
    const timeMs = lastThinkTimeMs + tickMs;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    brain.think(timeMs);
    microbit.display.advanceScroll(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

/**
 * A single-page brain whose rule, on page entry, draws `IMAGE` with an explicit
 * duration of 0, awaits the (already-resolved) handle, then lights pixel (4,4).
 * The explicit zero duration means the draw paints and resolves at dispatch, so
 * the rule never parks.
 */
function buildForgetBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 13 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // the Image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // duration = 0 (explicit fire-and-forget)
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: { numbers: [0, 4, 255], strings: [], values: [{ t: 1 }, imageConstant(TOP_ROW_PIXELS_HEX)] },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

/**
 * A single-page brain whose rule, on page entry, draws `IMAGE` for {@link
 * HOLD_MS}, awaits the hold, then lights pixel (4,4). The rule parks for the
 * hold and resumes on the first think past it.
 */
function buildTimedBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 13 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // the Image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 3 }, // duration = HOLD_MS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: {
        numbers: [0, 4, 255, HOLD_SECONDS],
        strings: [],
        values: [{ t: 1 }, imageConstant(TOP_ROW_PIXELS_HEX)],
      },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

/**
 * A two-rule brain. Rule 0 takes a timed lease (draws for {@link HOLD_MS}) and
 * parks; rule 1, running next in the same think, draws a different image with no
 * duration. Because the lease is held, rule 1's draw is silently dropped -- it
 * pastes nothing -- and resolves at dispatch, so rule 1 lights pixel (0,4). Rule
 * 0 resumes past the hold and lights pixel (4,4).
 */
function buildDroppedBrainJson(): LinkedBrainProgramJson {
  const holder = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 13 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // top-row image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 3 }, // duration = HOLD_MS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const competitor = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 3 },
    { op: Op.JMP_IF_FALSE, a: 12 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 2 }, // left-column image
    { op: Op.LIST_PUSH },
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 1, c: 4 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
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
      constantPools: {
        numbers: [0, 4, 255, HOLD_SECONDS],
        strings: [],
        values: [{ t: 1 }, imageConstant(TOP_ROW_PIXELS_HEX), imageConstant(LEFT_COL_PIXELS_HEX)],
      },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 3, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 4, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 5, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

/**
 * A single-page brain whose rule, on page entry, draws with no arguments and
 * awaits it, then lights pixel (0,0). With both slots absent the actuator draws
 * the default smiley and holds for the default 1000 ms; the rule parks for that
 * hold and resumes on the first think past it.
 */
function buildDefaultsBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 9 }, // relative: skip to the trailing void push
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 0, c: 1 }, // no image, no duration
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

  return {
    program: {
      version: 1,
      functions: [{ code: rule, numParams: 0, numLocals: 0 }],
      constantPools: { numbers: [0, 255], strings: [], values: [{ t: 1 }] },
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
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

function runFixture(
  name: string,
  build: () => LinkedBrainProgramJson,
  tickCount: number,
  tickMs: number = TICK_ADVANCE_MS
): void {
  runBytesFixture(name, () => serializeBrainBytes(build()), tickCount, tickMs);
}

/**
 * Pins the `.mcprogram.bin` + `.ticks.trace` golden for a brain whose serialized
 * bytes come from `buildBytes`: the bytes are byte-stable across builds, two
 * fresh runs render identical traces, and the rendered trace matches the
 * committed golden.
 */
function runBytesFixture(
  name: string,
  buildBytes: () => Uint8Array,
  tickCount: number,
  tickMs: number = TICK_ADVANCE_MS
): void {
  const binPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${name}.ticks.trace`, import.meta.url));

  // Build once and reuse: a build mints a fresh brain whose page id is drawn
  // from the environment RNG, so the same `built` bytes are the stability
  // reference for both the file write and the comparison below.
  const built = existsSync(binPath) ? undefined : buildBytes();
  if (built !== undefined) {
    writeFileSync(binPath, built);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, built ?? buildBytes(), `${name}.mcprogram.bin is not byte-stable`);

  const first = runDrawTrace(bin, tickCount, tickMs);
  const second = runDrawTrace(bin, tickCount, tickMs);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  if (!existsSync(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${name}.ticks.trace is not byte-stable`);
}

/**
 * A two-rule brain exercising the `immediately` modifier. Rule 0 takes a timed
 * lease (draws the top-row image) and parks; rule 1, running next in the same
 * think, draws the left-column image with the `immediately` modifier. The
 * modifier preempts rule 0's lease (resolving its handle so it resumes next
 * think) and rule 1's draw paints at once. Rule 1's draw is zero-duration, so it
 * takes no lease and continues in the same think, lighting pixel (0,4). Rule 0
 * resumes on the next think and lights pixel (4,4).
 */
function buildPreemptBrainJson(): LinkedBrainProgramJson {
  const holder = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 13 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // top-row image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 3 }, // duration = HOLD_SECONDS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const preemptor = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 3 },
    { op: Op.JMP_IF_FALSE, a: 14 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 2 }, // left-column image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // duration = 0 (fire-and-forget after preempt)
    { op: Op.PUSH_CONST_VAL, a: 3 }, // immediately modifier present
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 3, c: 4 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
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
        { code: preemptor, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [0, 4, 255, HOLD_SECONDS],
        strings: [],
        values: [
          { t: NativeType.Nil },
          imageConstant(TOP_ROW_PIXELS_HEX),
          imageConstant(LEFT_COL_PIXELS_HEX),
          { t: NativeType.Boolean, v: true },
        ],
      },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 3, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 4, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 5, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

test("a zero-duration draw paints, takes no lease, and continues in the same think", () => {
  runFixture("draw-image-forget", buildForgetBrainJson, 3);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-forget.mcprogram.bin", import.meta.url)))
    ),
    3
  );
  const lines = result.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 1);
  // Painted (0,0) full brightness from the top row and (4,4) from the resume marker.
  assert.equal(result.microbit.display.getPixelValue(0, 0), 255);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("a timed draw holds the display for its duration then the rule continues", () => {
  const resumeTick = Math.floor((TICK_ADVANCE_MS + HOLD_MS) / TICK_ADVANCE_MS) + 2;
  runFixture("draw-image-timed", buildTimedBrainJson, resumeTick);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-timed.mcprogram.bin", import.meta.url)))
    ),
    resumeTick
  );
  const lines = result.trace.split("\n");
  // One paste, and exactly one resume set-pixel after the hold.
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("a draw dispatched while the lease is held is silently dropped", () => {
  const resumeTick = Math.floor((TICK_ADVANCE_MS + HOLD_MS) / TICK_ADVANCE_MS) + 2;
  runFixture("draw-image-dropped", buildDroppedBrainJson, resumeTick);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-dropped.mcprogram.bin", import.meta.url)))
    ),
    resumeTick
  );
  const lines = result.trace.split("\n");
  // The holder pastes once; the competitor's draw is dropped, so only one draw line.
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 1);
  // Two async draw dispatches: the holder's and the dropped competitor's.
  assert.equal(lines.filter((line) => /^action .+ async$/.test(line)).length, 2);
  // The competitor still ran: it lit (0,4). The holder resumed and lit (4,4).
  assert.equal(result.microbit.display.getPixelValue(0, 4), 255);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  // The dropped draw pasted nothing: the left column (except the holder's top row) stays dark.
  assert.equal(result.microbit.display.getPixelValue(0, 2), 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

/** Packed bytes of the default smiley, matching DEFAULT_IMAGE in actions/display-draw.ts. */
const SMILEY_PIXELS_HEX = ["0000000000", "00ff00ff00", "0000000000", "ff000000ff", "00ffffff00"].join("");

test("a draw with no arguments draws the default smiley and holds for the default duration", () => {
  // 600ms thinks: the smiley holds for the default 1000ms (completes at 1600,
  // resolved at the think-3 poll) and the rule resumes on think 4.
  const tickMs = 600;
  runFixture("draw-image-defaults", buildDefaultsBrainJson, 4, tickMs);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-defaults.mcprogram.bin", import.meta.url)))
    ),
    4,
    tickMs
  );
  const lines = result.trace.split("\n");
  // The default smiley is pasted once.
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${SMILEY_PIXELS_HEX}`).length, 1);
  // The default 1000ms hold elapsed and the rule resumed, lighting (0,0).
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(result.microbit.display.getPixelValue(0, 0), 255);
  // A smiley eye and a mouth pixel were painted.
  assert.equal(result.microbit.display.getPixelValue(1, 1), 255);
  assert.equal(result.microbit.display.getPixelValue(2, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

/**
 * Builds, through the brain compiler, a single-page brain with two rules that
 * each fire on page entry: the first draws the `heart` built-in literal tile,
 * the second draws the `arrow-north` built-in literal tile. Both place their
 * built-in in the `draw image` actuator's anonymous image slot with an explicit
 * zero duration (fire-and-forget), so both paste in the same think with no lease
 * contention. The serialized program carries each built-in's baked `Image`
 * struct constant, in the same binary format the hand-authored fixtures use.
 */
function buildBuiltInImageBrainBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "built-in image draw brain");
  const page = brainDef.pages().get(0)!;
  const heartRule = page.children().get(0)!;
  const arrowRule = page.appendNewRule()!;
  appendBuiltInDrawRule(environment, brainDef, heartRule, "heart");
  appendBuiltInDrawRule(environment, brainDef, arrowRule, "arrow-north");

  const built = buildWodalProgramImage({
    brainDef,
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return serializeWodalProgramImageBytes(built.image, environment.brainServices.runtime.types);
}

/**
 * Fills `rule` with an on-page-entered when() and a `draw image` do() that draws
 * the named built-in fire-and-forget (the built-in literal tile in the anonymous
 * image slot, an explicit duration of 0).
 */
function appendBuiltInDrawRule(
  environment: MindcraftEnvironment,
  brainDef: BrainDef,
  rule: IBrainRuleDef,
  builtInName: string
): void {
  const tiles = environment.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const drawImage = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DrawImage.key));
  const image = tiles.get(builtInImageTileId(getBuiltInImage(builtInName)));
  const durationParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.Duration));
  assert.ok(onPageEntered, "on-page-entered sensor tile should be registered");
  assert.ok(drawImage, "draw image actuator tile should be registered");
  assert.ok(image, `built-in image tile '${builtInName}' should be registered`);
  assert.ok(durationParam, "duration parameter tile should be registered");

  rule.when().appendTile(onPageEntered);
  rule.do().appendTile(drawImage);
  rule.do().appendTile(image);
  rule.do().appendTile(durationParam);
  const zeroDuration = new BrainTileLiteralDef(CoreTypeIds.Number, 0, {}, environment.brainServices);
  brainDef.catalog().registerTileDef(zeroDuration);
  rule.do().appendTile(zeroDuration);
}

test("built-in image literal tiles draw their baked constants through draw image", () => {
  const tickCount = 2;
  runBytesFixture("draw-image-builtins", buildBuiltInImageBrainBytes, tickCount);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-builtins.mcprogram.bin", import.meta.url)))
    ),
    tickCount
  );
  const lines = result.trace.split("\n");
  // Both built-ins paste in the same think: the heart, then the arrow over it.
  const heartHex = builtInImageHex(getBuiltInImage("heart"));
  const arrowHex = builtInImageHex(getBuiltInImage("arrow-north"));
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${heartHex}`).length, 1);
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${arrowHex}`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("an immediately draw preempts the current lease and runs at once", () => {
  runFixture("draw-image-preempt", buildPreemptBrainJson, 3);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-preempt.mcprogram.bin", import.meta.url)))
    ),
    3
  );
  const lines = result.trace.split("\n");
  // Both draws paste: the holder, then the preemptor (not dropped) -- two draw lines.
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 2);
  assert.equal(lines.filter((line) => /^action .+ async$/.test(line)).length, 2);
  // The preemptor ran in the dispatch think and lit (0,4); the preempted holder
  // resumed on the next think and lit (4,4).
  assert.equal(result.microbit.display.getPixelValue(0, 4), 255);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

/** A 5x5 image whose center pixel (2,2) is full brightness, the third sequence frame. */
const CENTER_PIXEL_HEX = `${"00".repeat(12)}ff${"00".repeat(12)}`;

/** Per-image hold of the multi-image sequence fixtures, in seconds (200ms each). */
const SEQUENCE_HOLD_SECONDS = 0.2;

/**
 * A single-page brain whose rule, on page entry, draws a three-image sequence
 * (top row, then left column, then center) holding each frame for {@link
 * SEQUENCE_HOLD_SECONDS}, awaits the whole sequence, then lights pixel (4,4). The
 * three images fill the repeated anonymous image slot as a `List<Image>`; the
 * draw holds one lease for `3 * SEQUENCE_HOLD_SECONDS` and resumes the rule once
 * it elapses.
 */
function buildSequenceBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 17 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // top-row image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_VAL, a: 2 }, // left-column image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_VAL, a: 3 }, // center image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 2 }, // duration = SEQUENCE_HOLD_SECONDS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 0 }, // y = 4
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
      constantPools: {
        numbers: [4, 255, SEQUENCE_HOLD_SECONDS],
        strings: [],
        values: [
          { t: 1 },
          imageConstant(TOP_ROW_PIXELS_HEX),
          imageConstant(LEFT_COL_PIXELS_HEX),
          imageConstant(CENTER_PIXEL_HEX),
        ],
      },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

/**
 * A two-rule brain. Rule 0 takes a single-image timed draw (top row) for
 * {@link HOLD_SECONDS} and parks under the lease (one frame, so no per-frame
 * swap); rule 1, running next in the same think, draws a two-image sequence
 * (center, then top row). Because rule 0 holds the lease, rule 1's whole
 * sequence is silently dropped -- nothing pastes -- and resolves at dispatch, so
 * rule 1 lights pixel (4,0). Rule 0 resumes past its lease and lights pixel
 * (4,4).
 */
function buildSequenceDroppedBrainJson(): LinkedBrainProgramJson {
  const holder = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 13 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // top-row image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 3 }, // duration = HOLD_SECONDS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const competitor = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 3 },
    { op: Op.JMP_IF_FALSE, a: 14 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 2 }, // center image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_VAL, a: 1 }, // top-row image
    { op: Op.LIST_PUSH },
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 1, c: 4 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 0 }, // y = 0
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
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
      constantPools: {
        numbers: [0, 4, 255, HOLD_SECONDS],
        strings: [],
        values: [{ t: 1 }, imageConstant(TOP_ROW_PIXELS_HEX), imageConstant(CENTER_PIXEL_HEX)],
      },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 3, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 4, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 5, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

/**
 * A two-rule brain. Rule 0 draws a two-image sequence (top row, then left
 * column) for {@link HOLD_SECONDS} per frame and parks under the lease; rule 1,
 * running next in the same think, draws the center image with the `immediately`
 * modifier and a zero duration. The modifier preempts rule 0's lease (resolving
 * its handle so it resumes next think, only its first frame ever shown) and rule
 * 1's draw paints at once and continues the same think (fire-and-forget),
 * lighting pixel (0,0). Rule 0 resumes and lights pixel (4,4).
 */
function buildSequencePreemptBrainJson(): LinkedBrainProgramJson {
  const holder = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 15 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 1 }, // top-row image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_VAL, a: 2 }, // left-column image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 3 }, // duration = HOLD_SECONDS
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 2, c: 1 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 4
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 4
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
    { op: Op.HOST_ACTION_CALL, a: DISPLAY_SET_PIXEL, b: 3, c: 2 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];
  const preemptor = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 3 },
    { op: Op.JMP_IF_FALSE, a: 14 }, // relative: skip to the trailing void push
    { op: Op.LIST_NEW, a: 0 }, // image sequence list
    { op: Op.PUSH_CONST_VAL, a: 3 }, // center image
    { op: Op.LIST_PUSH },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // duration = 0 (fire-and-forget after preempt)
    { op: Op.PUSH_CONST_VAL, a: 4 }, // immediately modifier present
    { op: Op.HOST_ACTION_CALL_ASYNC, a: DRAW_IMAGE, b: 3, c: 4 },
    { op: Op.AWAIT },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 0 }, // y = 0
    { op: Op.PUSH_CONST_NUM, a: 2 }, // brightness = 255
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
        { code: preemptor, numParams: 0, numLocals: 0 },
      ],
      constantPools: {
        numbers: [0, 4, 255, HOLD_SECONDS],
        strings: [],
        values: [
          { t: NativeType.Nil },
          imageConstant(TOP_ROW_PIXELS_HEX),
          imageConstant(LEFT_COL_PIXELS_HEX),
          imageConstant(CENTER_PIXEL_HEX),
          { t: NativeType.Boolean, v: true },
        ],
      },
      types: [IMAGE_TYPE_ENTRY],
      variableNames: [],
      entryPoint: 0,
      actions: [],
      ruleFuncIds: [0, 1],
      ruleAncestors: [],
    },
    pages: [
      {
        pageIndex: 0,
        pageId: "draw-page-0",
        pageName: "Draw Page 0",
        rootRuleFuncIds: [0, 1],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
          { binding: "host", callSiteId: 3, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 4, actionId: DRAW_IMAGE },
          { binding: "host", callSiteId: 5, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  } as LinkedBrainProgramJson;
}

/**
 * Builds, through the brain compiler, a single-page brain whose one rule draws
 * two built-in image tiles (heart, then arrow-north) in the `draw image`
 * actuator's repeated anonymous image slot, held for {@link
 * SEQUENCE_HOLD_SECONDS} each. The two anonymous image tiles must compile to a
 * single `List<Image>` arg (the repeated-slot gather), which the actuator plays
 * as a two-frame sequence under one lease.
 */
function buildCompiledSequenceBytes(): Uint8Array {
  const environment = createMicroBitV2Environment();
  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "image sequence draw brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;

  const tiles = environment.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const drawImage = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DrawImage.key));
  const heart = tiles.get(builtInImageTileId(getBuiltInImage("heart")));
  const arrow = tiles.get(builtInImageTileId(getBuiltInImage("arrow-north")));
  const durationParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.Duration));
  assert.ok(onPageEntered && drawImage && heart && arrow && durationParam);

  rule.when().appendTile(onPageEntered);
  rule.do().appendTile(drawImage);
  rule.do().appendTile(heart);
  rule.do().appendTile(arrow);
  rule.do().appendTile(durationParam);
  const durationLiteral = new BrainTileLiteralDef(
    CoreTypeIds.Number,
    SEQUENCE_HOLD_SECONDS,
    {},
    environment.brainServices
  );
  brainDef.catalog().registerTileDef(durationLiteral);
  rule.do().appendTile(durationLiteral);

  const built = buildWodalProgramImage({
    brainDef,
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return serializeWodalProgramImageBytes(built.image, environment.brainServices.runtime.types);
}

test("a multi-image draw plays each frame for its hold under one lease", () => {
  // 100ms thinks: three 200ms frames lease [100, 700); frames swap at 100/300/500
  // and the rule resumes on the first think past 700 (think 8) to light (4,4).
  const tickCount = 8;
  runFixture("draw-image-sequence", buildSequenceBrainJson, tickCount);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-sequence.mcprogram.bin", import.meta.url)))
    ),
    tickCount
  );
  const lines = result.trace.split("\n");
  // One async dispatch (one lease) and three distinct frame pastes, in order.
  assert.equal(lines.filter((line) => /^action .+ async$/.test(line)).length, 1);
  const drawLines = lines.filter((line) => line.startsWith("port display draw "));
  assert.equal(drawLines.length, 3);
  assert.equal(drawLines[0], `port display draw 5 5 ${TOP_ROW_PIXELS_HEX}`);
  assert.equal(drawLines[1], `port display draw 5 5 ${LEFT_COL_PIXELS_HEX}`);
  assert.equal(drawLines[2], `port display draw 5 5 ${CENTER_PIXEL_HEX}`);
  // The last frame (center) persists and the rule resumed past the total, lighting (4,4).
  assert.equal(result.microbit.display.getPixelValue(2, 2), 255);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("a multi-image sequence dispatched while the lease is held is silently dropped", () => {
  const resumeTick = Math.floor((TICK_ADVANCE_MS + HOLD_MS) / TICK_ADVANCE_MS) + 2;
  runFixture("draw-image-sequence-dropped", buildSequenceDroppedBrainJson, resumeTick);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-sequence-dropped.mcprogram.bin", import.meta.url)))
    ),
    resumeTick
  );
  const lines = result.trace.split("\n");
  // Only the holder's single frame pastes; the competitor's whole sequence is dropped.
  const drawLines = lines.filter((line) => line.startsWith("port display draw "));
  assert.equal(drawLines.length, 1);
  assert.equal(lines.filter((line) => /^action .+ async$/.test(line)).length, 2);
  // The dropped competitor pasted nothing -- its center frame never crosses the port.
  assert.ok(!drawLines.some((line) => line.includes(CENTER_PIXEL_HEX)));
  // Both rules ran their post-draw code: the competitor continued past its dropped
  // (resolved-at-dispatch) draw and the holder resumed past its lease, so each lit
  // a marker pixel.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  // The holder's marker (4,4) is set after its final frame, so it persists.
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  // The dropped competitor's center frame never pasted, so (2,2) stays dark.
  assert.equal(result.microbit.display.getPixelValue(2, 2), 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("an immediately draw preempts a held image sequence and runs at once", () => {
  runFixture("draw-image-sequence-preempt", buildSequencePreemptBrainJson, 3);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-sequence-preempt.mcprogram.bin", import.meta.url)))
    ),
    3
  );
  const lines = result.trace.split("\n");
  // The holder shows only its first frame before being preempted; the preemptor
  // then pastes its frame -- two draw lines, one per rule.
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 2);
  assert.equal(lines.filter((line) => /^action .+ async$/.test(line)).length, 2);
  // The preemptor ran in the dispatch think (lit (0,0)); the preempted holder
  // resumed on the next think (lit (4,4)).
  assert.equal(result.microbit.display.getPixelValue(0, 0), 255);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("two anonymous image tiles compile to a List and play as a sequence", () => {
  // 100ms thinks: two 200ms frames lease [100, 500); the arrow swaps in at 300.
  const tickCount = 5;
  runBytesFixture("draw-image-sequence-compiled", buildCompiledSequenceBytes, tickCount);
  const result = runDrawTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/draw-image-sequence-compiled.mcprogram.bin", import.meta.url)))
    ),
    tickCount
  );
  const lines = result.trace.split("\n");
  // The two anonymous image tiles gathered into one List arg -> one async draw
  // dispatch that plays both frames in order.
  assert.equal(lines.filter((line) => /^action .+ async$/.test(line)).length, 1);
  const heartHex = builtInImageHex(getBuiltInImage("heart"));
  const arrowHex = builtInImageHex(getBuiltInImage("arrow-north"));
  const drawLines = lines.filter((line) => line.startsWith("port display draw "));
  assert.equal(drawLines.length, 2);
  assert.equal(drawLines[0], `port display draw 5 5 ${heartHex}`);
  assert.equal(drawLines[1], `port display draw 5 5 ${arrowHex}`);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});
