/**
 * Golden observable traces for the timeout / page-switch scheduler fixtures plus
 * a synthetic core host-action coverage probe.
 *
 * The timer and timeout-bounce brains are built through the real brain compiler
 * from tiles, so their bytecode carries the WHEN/DO boundary opcodes and real
 * rule structure:
 *
 * - timer-brain: page 0's rule fires on a one-second timeout and switches to
 *   page 2, whose rule lights a pixel on entry.
 * - timeout-bounce: each page carries a one-second timeout that switches to the
 *   other page, so a timeout entered via a page switch must re-arm and fire.
 *
 * The coverage and restart-interrupt brains are hand-constructed synthetic
 * probes, not brain goldens, because each packs more than one action into a
 * single rule, which the brain compiler does not emit (a rule's do() compiles
 * exactly one action):
 *
 * - core-host-actions: calls current-page, previous-page, yield, and restart-page
 *   as discarded statements purely to surface their results in the trace.
 * - restart-interrupt: switches to its own page (a restart) and then attempts a
 *   pixel write in the same rule, so the restart cancels the rule before the
 *   pixel write reaches the device.
 *
 * The serialized binaries and rendered traces are pinned beside this spec as the
 * cross-VM conformance fixtures: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binaries and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type MindcraftEnvironment, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import { type IBrainPageDef, type IBrainTileDef, mkPageTileId } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainRuntime,
  CoreHostActions,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  linkedBrainProgramToJson,
  Op,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import {
  parseWodalProgramImageBytes,
  serializeWodalProgramImageBytes,
  wodalProgramBytes,
} from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const SWITCH_PAGE = CoreHostActions.SwitchPage.actionId;
const RESTART_PAGE = CoreHostActions.RestartPage.actionId;
const YIELD = CoreHostActions.Yield.actionId;
const ON_PAGE_ENTERED = CoreHostActions.OnPageEntered.actionId;
const TIMEOUT = CoreHostActions.Timeout.actionId;
const CURRENT_PAGE = CoreHostActions.CurrentPage.actionId;
const PREVIOUS_PAGE = CoreHostActions.PreviousPage.actionId;
const DISPLAY_SET_PIXEL = MicroBitV2HostActions.DisplaySetPixel.actionId;

const TIMER_JSON_PATH = fileURLToPath(new URL("./__fixtures__/timer-brain.mcprogram", import.meta.url));
const TIMER_BIN_PATH = fileURLToPath(new URL("./__fixtures__/timer-brain.mcprogram.bin", import.meta.url));
const TIMER_TRACE_PATH = fileURLToPath(new URL("./__fixtures__/timer-brain.ticks.trace", import.meta.url));
const COVERAGE_BIN_PATH = fileURLToPath(new URL("./__fixtures__/core-host-actions.mcprogram.bin", import.meta.url));
const COVERAGE_TRACE_PATH = fileURLToPath(new URL("./__fixtures__/core-host-actions.ticks.trace", import.meta.url));
const RESTART_INTERRUPT_BIN_PATH = fileURLToPath(
  new URL("./__fixtures__/restart-interrupt.mcprogram.bin", import.meta.url)
);
const RESTART_INTERRUPT_TRACE_PATH = fileURLToPath(
  new URL("./__fixtures__/restart-interrupt.ticks.trace", import.meta.url)
);
const TIMEOUT_BOUNCE_JSON_PATH = fileURLToPath(new URL("./__fixtures__/timeout-bounce.mcprogram", import.meta.url));
const TIMEOUT_BOUNCE_BIN_PATH = fileURLToPath(new URL("./__fixtures__/timeout-bounce.mcprogram.bin", import.meta.url));
const TIMEOUT_BOUNCE_TRACE_PATH = fileURLToPath(new URL("./__fixtures__/timeout-bounce.ticks.trace", import.meta.url));

function tile(env: MindcraftEnvironment, tileId: string): IBrainTileDef {
  const found = env.brainServices.edit.tiles.get(tileId);
  assert.ok(found, `tile ${tileId} should be registered`);
  return found;
}

function pageTile(brainDef: BrainDef, page: IBrainPageDef): IBrainTileDef {
  const found = brainDef.catalog().get(mkPageTileId(page.pageId()));
  assert.ok(found, "page tile should be synced into the catalog");
  return found;
}

/**
 * A two-page timer brain. Page 0's rule fires on a one-second timeout and
 * switches to page 1; page 1's rule lights pixel (0,0) on page entry.
 */
function buildTimerBrainDef(env: MindcraftEnvironment): BrainDef {
  const timeout = tile(env, mkSensorTileId(CoreHostActions.Timeout.key));
  const switchPage = tile(env, mkActuatorTileId(CoreHostActions.SwitchPage.key));
  const onPageEntered = tile(env, mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const setPixel = tile(env, mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "timer brain");
  const page0 = brainDef.pages().get(0)!;
  const appended = brainDef.appendNewPage();
  assert.ok(appended.success);
  const page1 = appended.value.page;

  const switchRule = page0.children().get(0)!;
  switchRule.when().appendTile(timeout);
  switchRule.do().appendTile(switchPage);
  switchRule.do().appendTile(pageTile(brainDef, page1));

  const pixelRule = page1.children().get(0)!;
  pixelRule.when().appendTile(onPageEntered);
  pixelRule.do().appendTile(setPixel);
  return brainDef;
}

/**
 * A two-page bounce brain. Each page's rule fires on a one-second timeout and
 * switches to the other page, so the timeout must re-arm on each page it lands
 * on and the pages bounce back and forth.
 */
function buildBounceBrainDef(env: MindcraftEnvironment): BrainDef {
  const timeout = tile(env, mkSensorTileId(CoreHostActions.Timeout.key));
  const switchPage = tile(env, mkActuatorTileId(CoreHostActions.SwitchPage.key));

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "timeout bounce brain");
  const page0 = brainDef.pages().get(0)!;
  const appended = brainDef.appendNewPage();
  assert.ok(appended.success);
  const page1 = appended.value.page;

  const page0Rule = page0.children().get(0)!;
  page0Rule.when().appendTile(timeout);
  page0Rule.do().appendTile(switchPage);
  page0Rule.do().appendTile(pageTile(brainDef, page1));

  const page1Rule = page1.children().get(0)!;
  page1Rule.when().appendTile(timeout);
  page1Rule.do().appendTile(switchPage);
  page1Rule.do().appendTile(pageTile(brainDef, page0));
  return brainDef;
}

/**
 * A single-page brain whose rule, on page entry, switches to its own page (a
 * restart) and then attempts a pixel write. The restart cancels the running
 * rule, so the pixel write after it must never reach the device. Hand-built
 * because a rule's do() compiles a single action, so a real brain cannot place
 * a pixel write after the same rule's restart for the restart to cancel.
 */
function buildRestartInterruptBrainJson(): LinkedBrainProgramJson {
  const rule = [
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 0 },
    { op: Op.JMP_IF_FALSE, a: 10 },
    { op: Op.PUSH_CONST_NUM, a: 0 }, // switch-page number slot: page 1 (the current page)
    { op: Op.PUSH_CONST_VAL, a: 0 }, // switch-page string slot: nil
    { op: Op.HOST_ACTION_CALL, a: SWITCH_PAGE, b: 2, c: 1 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_NUM, a: 1 }, // x = 0
    { op: Op.PUSH_CONST_NUM, a: 1 }, // y = 0
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
      constantPools: { numbers: [1, 0, 255], strings: [], values: [{ t: 1 }] },
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
        pageId: "restart-page-0",
        pageName: "Restart Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 1, actionId: SWITCH_PAGE },
          { binding: "host", callSiteId: 2, actionId: DISPLAY_SET_PIXEL },
        ],
      },
    ],
  };
}

/**
 * A two-page coverage brain. Page 0's rule reads current/previous page, yields,
 * and on the first tick switches to page 2 by stable page id; page 1's rule
 * reads current/previous page and restarts itself each tick. Hand-constructed
 * because it calls the observable core actions as discarded statements, which a
 * valid compile never emits.
 */
function buildCoverageBrainJson(): LinkedBrainProgramJson {
  const page0Rule = [
    { op: Op.HOST_ACTION_CALL, a: CURRENT_PAGE, b: 0, c: 0 },
    { op: Op.POP },
    { op: Op.HOST_ACTION_CALL, a: PREVIOUS_PAGE, b: 0, c: 1 },
    { op: Op.POP },
    { op: Op.HOST_ACTION_CALL, a: YIELD, b: 0, c: 2 },
    { op: Op.POP },
    { op: Op.HOST_ACTION_CALL, a: ON_PAGE_ENTERED, b: 0, c: 3 },
    { op: Op.JMP_IF_FALSE, a: 5 },
    { op: Op.PUSH_CONST_VAL, a: 0 }, // switch-page number slot: nil
    { op: Op.PUSH_CONST_STR, a: 0 }, // switch-page string slot: "cov-page-1"
    { op: Op.HOST_ACTION_CALL, a: SWITCH_PAGE, b: 2, c: 4 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  const page1Rule = [
    { op: Op.HOST_ACTION_CALL, a: CURRENT_PAGE, b: 0, c: 5 },
    { op: Op.POP },
    { op: Op.HOST_ACTION_CALL, a: PREVIOUS_PAGE, b: 0, c: 6 },
    { op: Op.POP },
    { op: Op.HOST_ACTION_CALL, a: RESTART_PAGE, b: 0, c: 7 },
    { op: Op.POP },
    { op: Op.PUSH_CONST_VAL, a: 0 },
    { op: Op.RET },
  ];

  return {
    program: {
      version: 1,
      functions: [
        { code: page0Rule, numParams: 0, numLocals: 0 },
        { code: page1Rule, numParams: 0, numLocals: 0 },
      ],
      constantPools: { numbers: [], strings: ["cov-page-1"], values: [{ t: 1 }] },
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
        pageId: "cov-page-0",
        pageName: "Coverage Page 0",
        rootRuleFuncIds: [0],
        actionCallSites: [
          { binding: "host", callSiteId: 0, actionId: CURRENT_PAGE },
          { binding: "host", callSiteId: 1, actionId: PREVIOUS_PAGE },
          { binding: "host", callSiteId: 2, actionId: YIELD },
          { binding: "host", callSiteId: 3, actionId: ON_PAGE_ENTERED },
          { binding: "host", callSiteId: 4, actionId: SWITCH_PAGE },
        ],
      },
      {
        pageIndex: 1,
        pageId: "cov-page-1",
        pageName: "Coverage Page 1",
        rootRuleFuncIds: [1],
        actionCallSites: [
          { binding: "host", callSiteId: 5, actionId: CURRENT_PAGE },
          { binding: "host", callSiteId: 6, actionId: PREVIOUS_PAGE },
          { binding: "host", callSiteId: 7, actionId: RESTART_PAGE },
        ],
      },
    ],
  };
}

/** Serializes a hand-authored brain JSON to its binary `.mcprogram` payload. */
function serializeBrainBytes(json: LinkedBrainProgramJson): Uint8Array {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const linked = linkedBrainProgramFromJson(json);
  const image = profile.createProgramImage(linked);
  return serializeWodalProgramImageBytes(image, environment.brainServices.runtime.types);
}

/** Builds a compiled brain image through the standard build path. */
function buildImage(brainDef: BrainDef, env: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated page ids. */
function ensureJsonGolden(jsonPath: string, build: (env: MindcraftEnvironment) => BrainDef): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const env = createMicroBitV2Environment();
  const image = buildImage(build(env), env);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Derives the byte-stable binary from a frozen JSON golden, pinning the `.bin` on first run. */
function pinnedBinary(jsonPath: string, binPath: string): Uint8Array {
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (!existsSync(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${binPath} is not byte-stable`);
  return bin;
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Runs `bin` over `tickCount` 600ms thinks with the trace taps installed for
 * `tappedActionIds`, returning the rendered trace plus the device.
 */
function runTrace(
  bin: Uint8Array,
  tappedActionIds: readonly number[],
  tickCount: number
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
  for (const actionId of tappedActionIds) {
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

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + 600;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    brain.think(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed timer-brain binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden(TIMER_JSON_PATH, buildTimerBrainDef);
  const bin = pinnedBinary(TIMER_JSON_PATH, TIMER_BIN_PATH);

  const tapped = [TIMEOUT, SWITCH_PAGE, ON_PAGE_ENTERED, DISPLAY_SET_PIXEL];
  const first = runTrace(bin, tapped, 4);
  const second = runTrace(bin, tapped, 4);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 4);
  // The timeout fires once, driving one switch-page; page 1 lights the pixel once
  // after the switch lands.
  assert.equal(lines.filter((line) => new RegExp(`^action ${TIMEOUT} .+ result bool 1$`).test(line)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith(`action ${SWITCH_PAGE} `)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (!existsSync(TIMER_TRACE_PATH)) {
    writeFileSync(TIMER_TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TIMER_TRACE_PATH, "utf8"), first.trace, "timer-brain.ticks.trace is not byte-stable");
});

test("a timeout on a page entered via switch re-arms and fires (pages bounce)", () => {
  ensureJsonGolden(TIMEOUT_BOUNCE_JSON_PATH, buildBounceBrainDef);
  const bin = pinnedBinary(TIMEOUT_BOUNCE_JSON_PATH, TIMEOUT_BOUNCE_BIN_PATH);

  const tapped = [TIMEOUT, SWITCH_PAGE];
  const first = runTrace(bin, tapped, 10);
  const second = runTrace(bin, tapped, 10);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  // Each page carries its own timeout call site; both must fire for the pages to
  // bounce, so the timeout fires from at least two distinct call sites.
  const firedTimeoutSites = new Set(
    lines
      .map((line) => new RegExp(`^action ${TIMEOUT} site (\\d+) .+ result bool 1$`).exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1])
  );
  assert.ok(
    firedTimeoutSites.size >= 2,
    `each page's timeout should fire (saw sites ${[...firedTimeoutSites].join(", ")})`
  );
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(TIMEOUT_BOUNCE_TRACE_PATH)) {
    writeFileSync(TIMEOUT_BOUNCE_TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(TIMEOUT_BOUNCE_TRACE_PATH, "utf8"),
    first.trace,
    "timeout-bounce.ticks.trace is not byte-stable"
  );
});

test("the committed core-host-actions coverage probe binary and observable trace are byte-stable", () => {
  if (!existsSync(COVERAGE_BIN_PATH)) {
    writeFileSync(COVERAGE_BIN_PATH, serializeBrainBytes(buildCoverageBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(COVERAGE_BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildCoverageBrainJson()),
    "core-host-actions.mcprogram.bin is not byte-stable"
  );

  const tapped = [CURRENT_PAGE, PREVIOUS_PAGE, YIELD, ON_PAGE_ENTERED, SWITCH_PAGE, RESTART_PAGE];
  const first = runTrace(bin, tapped, 3);
  const second = runTrace(bin, tapped, 3);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // On-page-entered fires once and drives one switch-page-by-id; the page-1 rule
  // restarts itself on each of ticks 2 and 3.
  assert.equal(lines.filter((line) => new RegExp(`^action ${ON_PAGE_ENTERED} .+ result bool 1$`).test(line)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith(`action ${SWITCH_PAGE} `)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith(`action ${RESTART_PAGE} `)).length, 2);
  assert.equal(
    lines.filter((line) => new RegExp(`^action ${CURRENT_PAGE} .+ result string "cov-page-1"$`).test(line)).length,
    2
  );
  assert.equal(
    lines.filter((line) => new RegExp(`^action ${PREVIOUS_PAGE} .+ result string "cov-page-0"$`).test(line)).length,
    3
  );
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(COVERAGE_TRACE_PATH)) {
    writeFileSync(COVERAGE_TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(COVERAGE_TRACE_PATH, "utf8"),
    first.trace,
    "core-host-actions.ticks.trace is not byte-stable"
  );
});

test("the committed restart-interrupt binary and observable trace golden are byte-stable", () => {
  if (!existsSync(RESTART_INTERRUPT_BIN_PATH)) {
    writeFileSync(RESTART_INTERRUPT_BIN_PATH, serializeBrainBytes(buildRestartInterruptBrainJson()));
  }
  const bin = new Uint8Array(readFileSync(RESTART_INTERRUPT_BIN_PATH));
  assert.deepEqual(
    bin,
    serializeBrainBytes(buildRestartInterruptBrainJson()),
    "restart-interrupt.mcprogram.bin is not byte-stable"
  );

  const tapped = [ON_PAGE_ENTERED, SWITCH_PAGE, DISPLAY_SET_PIXEL];
  const first = runTrace(bin, tapped, 3);
  const second = runTrace(bin, tapped, 3);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, 3);
  // On-page-entered fires once and drives the same-page switch (a restart), which
  // cancels the rule before its pixel write: no pixel ever reaches the device.
  assert.equal(lines.filter((line) => new RegExp(`^action ${ON_PAGE_ENTERED} .+ result bool 1$`).test(line)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith(`action ${SWITCH_PAGE} `)).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith(`action ${DISPLAY_SET_PIXEL} `)).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 0);

  if (!existsSync(RESTART_INTERRUPT_TRACE_PATH)) {
    writeFileSync(RESTART_INTERRUPT_TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(RESTART_INTERRUPT_TRACE_PATH, "utf8"),
    first.trace,
    "restart-interrupt.ticks.trace is not byte-stable"
  );
});
