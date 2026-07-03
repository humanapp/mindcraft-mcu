/**
 * Golden observable trace for a REAL compiled brain proving the `in background`
 * modifier on `display text`: the parent rule fires once on page entry and its DO
 * scrolls text with the `in background` modifier, so its async handle resolves at
 * dispatch and the parent does not park on the animation. The parent's single
 * child rule lights a pixel; the parent resolves at dispatch, so the child runs
 * in the dispatch think, while the scroll animation is still in flight.
 *
 * The brain is built through the tile API and compiled by the brain compiler, so
 * the parent's child invocation is the compiler-emitted SPAWN_RULE. The JSON,
 * binary, and rendered trace are pinned beside this spec as the cross-VM
 * conformance fixture: the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreHostActions,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { SCROLL_DEFAULT_DELAY_MS, scrollCompletionTimeMs } from "./display-scroll";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId } from "./tile-ids";

const DISPLAY_SCROLL = MicroBitV2HostActions.DisplayScroll.actionId;

const BASE = "display-scroll-background";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;
const TICK_COUNT = 8;

/**
 * A one-page brain: a parent rule that fires once on page entry (when) and
 * scrolls text in the background (do, asynchronous with the `in background`
 * modifier), with a single child rule that lights a pixel.
 */
function buildBrainDef(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const scrollTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key));
  const inBackground = tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.InBackground));
  const setPixelTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(onPageEntered);
  assert.ok(scrollTile);
  assert.ok(inBackground);
  assert.ok(setPixelTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(onPageEntered);
  parent.do().appendTile(scrollTile);
  parent.do().appendTile(inBackground);

  const child = parent.appendNewRule();
  child.do().appendTile(setPixelTile);

  return brainDef;
}

function buildImage(env: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef: buildBrainDef(env),
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated id. */
function ensureJsonGolden(): void {
  if (existsSync(JSON_PATH)) {
    return;
  }
  const env = createMicroBitV2Environment();
  const image = buildImage(env);
  writeFileSync(
    JSON_PATH,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Runs the committed binary over the fixed tick schedule with scroll and set-pixel taps. */
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

  const scrollAction = environment.brainServices.runtime.actions.getById(DISPLAY_SCROLL);
  assert.ok(scrollAction !== undefined && scrollAction.binding === "host");
  const execAsync = scrollAction.execAsync;
  assert.ok(execAsync !== undefined);
  scrollAction.execAsync = (ctx, args, handle) => {
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    execAsync(ctx, args, handle);
    writer.hostActionCallAsync(DISPLAY_SCROLL, callSiteId, args);
  };

  for (const actionId of [CoreHostActions.OnPageEntered.actionId, MicroBitV2HostActions.DisplaySetPixel.actionId]) {
    const syncAction = environment.brainServices.runtime.actions.getById(actionId);
    assert.ok(syncAction !== undefined && syncAction.binding === "host");
    const syncExec = syncAction.execSync;
    assert.ok(syncExec !== undefined);
    syncAction.execSync = (ctx, args) => {
      const result = syncExec(ctx, args);
      const callSiteId = ctx.currentCallSiteId;
      assert.ok(callSiteId !== undefined);
      writer.hostActionCall(actionId, callSiteId, args, result);
      return result;
    };
  }

  const microbit = new MicroBit();
  const deviceScrollText = microbit.display.scrollText.bind(microbit.display);
  microbit.display.scrollText = (text, durationMs, requestTime, onComplete) => {
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

  const vmEvents: VmEvents = {
    onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code),
  };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + TICK_ADVANCE_MS;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(TICK_ADVANCE_MS);
    microbit.display.advanceScroll(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

/** The 1-based tick index whose block contains a line matching `predicate`, or -1. */
function tickOfLine(trace: string, predicate: (line: string) => boolean): number {
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 10);
    } else if (predicate(line)) {
      return currentTick;
    }
  }
  return -1;
}

test("the committed display-scroll-background binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, `${BASE}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin, TICK_COUNT);
  const second = runTrace(bin, TICK_COUNT);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, TICK_COUNT);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The parent scrolls once and the child lights one pixel.
  assert.equal(lines.filter((line) => line.startsWith("port display scroll ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);

  // The parent dispatches its scroll on the entry think and the child lights its
  // pixel the think after dispatch -- the parent did not park on the animation.
  // The child spawns via the compiler-emitted SPAWN_RULE and is scheduled on the
  // next think.
  const scrollTick = tickOfLine(first, (l) => l.startsWith("port display scroll "));
  const pixelTick = tickOfLine(first, (l) => l.startsWith("port display set-pixel "));
  assert.equal(scrollTick, 1);
  assert.equal(pixelTick, scrollTick + 1);

  // The scroll lease genuinely outlasts the child: the "hello" default animation
  // completes several thinks later, so the child ran while the scroll was in
  // flight. SCROLLED_TEXT is the default text when the call omits a text tile.
  const SCROLLED_TEXT = "hello";
  const completionTick = Math.ceil(
    scrollCompletionTimeMs(TICK_ADVANCE_MS, SCROLLED_TEXT.length, SCROLL_DEFAULT_DELAY_MS) / TICK_ADVANCE_MS
  );
  assert.ok(completionTick > pixelTick + 1, "the background scroll holds the lease past the child's think");

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
