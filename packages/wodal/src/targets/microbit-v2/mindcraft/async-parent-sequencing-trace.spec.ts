/**
 * Golden observable trace for a REAL compiled brain proving the parent->child
 * sequencing invariant: a child rule runs only AFTER its parent rule is fully
 * done, including resolving the parent's own async AWAIT. The parent rule fires
 * once on page entry and its DO scrolls text (an asynchronous display action);
 * the parent fiber parks on the scroll's AWAIT. Its single child rule lights a
 * pixel. Because the compiler spawns child rules at the parent's tail (after the
 * DO action and its await), the child does not run while the scroll is in
 * flight: the pixel appears only in a think after the scroll completes.
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
import { CoreHostActions, type MindcraftEnvironment, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const DISPLAY_SCROLL = MicroBitV2HostActions.DisplayScroll.actionId;

const BASE = "async-parent-sequencing";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;
const TICK_COUNT = 12;

/**
 * A one-page brain: a parent rule that fires once on page entry (when) and
 * scrolls text (do, asynchronous), with a single child rule that lights a pixel.
 */
function buildBrainDef(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const scrollTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key));
  const setPixelTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(onPageEntered);
  assert.ok(scrollTile);
  assert.ok(setPixelTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(onPageEntered);
  parent.do().appendTile(scrollTile);

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
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

/** The 1-based tick index whose block contains a line matching `predicate`, or -1. */
function tickOfLine(trace: string, predicate: (line: string) => boolean): number {
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (predicate(line)) {
      return currentTick;
    }
  }
  return -1;
}

test("the committed async-parent-sequencing binary and observable trace golden are byte-stable", () => {
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

  // The parent fires once (one scroll dispatch) and the child runs once (one
  // set-pixel) -- no loop, because the parent's WHEN (on-page-entered) is true
  // only on the entry think.
  assert.equal(lines.filter((line) => line.startsWith("port display scroll ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);

  // Sequencing: the child's pixel lands strictly after the parent's async scroll
  // was dispatched -- the child did not run while the parent was awaiting.
  const scrollTick = tickOfLine(first, (l) => l.startsWith("port display scroll "));
  const pixelTick = tickOfLine(first, (l) => l.startsWith("port display set-pixel "));
  assert.ok(scrollTick > 0, "the parent must dispatch its async scroll");
  assert.ok(pixelTick > scrollTick, "the child must run only after the parent's async resolves");

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
