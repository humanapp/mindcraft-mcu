/**
 * Golden observable trace for a REAL compiled brain proving `immediately` and `in
 * background` compose on `draw image`. A holder root rule draws for a long
 * duration and parks on its await, taking the display lease. A preemptor root
 * rule draws with BOTH the `immediately` and `in background` modifiers: the
 * `immediately` modifier preempts the holder's lease so the preemptor's draw
 * paints at once (both draws cross the port) and the holder's await resolves, and
 * the `in background` modifier resolves the preemptor's handle at dispatch so the
 * preemptor does not park. Each root rule has a child rule that lights a pixel;
 * both children run within the first thinks: the preemptor did not park, and the
 * preemption resolved the holder's await before the long hold elapsed.
 *
 * The brain is built through the tile API and compiled by the brain compiler, so
 * each parent's child invocation is the compiler-emitted SPAWN_RULE. The JSON,
 * binary, and rendered trace are pinned beside this spec as the cross-VM
 * conformance fixture: the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BrainTileLiteralDef,
  CoreHostActions,
  CoreTypeIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId, WodalMicroBitV2ParameterId } from "./tile-ids";

const DRAW_IMAGE = MicroBitV2HostActions.DrawImage.actionId;

const BASE = "draw-image-background-immediately";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;
const TICK_COUNT = 5;

/** Seconds the holder's draw would hold the display absent preemption. */
const HOLDER_SECONDS = 10;

/**
 * A one-page brain: a holder root rule that draws for {@link HOLDER_SECONDS} and
 * parks, plus a preemptor root rule that draws with the `immediately` and `in
 * background` modifiers. Each root rule has a child rule that lights a pixel.
 */
function buildBrainDef(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const drawTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DrawImage.key));
  const durationParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.Duration));
  const immediately = tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.Immediately));
  const inBackground = tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.InBackground));
  const setPixelTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(onPageEntered);
  assert.ok(drawTile);
  assert.ok(durationParam);
  assert.ok(immediately);
  assert.ok(inBackground);
  assert.ok(setPixelTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const page = brainDef.pages().get(0)! as BrainPageDef;

  // Holder: draws for a long duration and parks, taking the lease.
  const holder = page.children().get(0)! as BrainRuleDef;
  holder.when().appendTile(onPageEntered);
  holder.do().appendTile(drawTile);
  holder.do().appendTile(durationParam);
  const holdSeconds = new BrainTileLiteralDef(CoreTypeIds.Number, HOLDER_SECONDS, {}, env.brainServices);
  brainDef.catalog().registerTileDef(holdSeconds);
  holder.do().appendTile(holdSeconds);
  holder.appendNewRule().do().appendTile(setPixelTile);

  // Preemptor: draws with immediately + in background, then a child lights a pixel.
  const preemptor = page.appendNewRule();
  preemptor.when().appendTile(onPageEntered);
  preemptor.do().appendTile(drawTile);
  preemptor.do().appendTile(immediately);
  preemptor.do().appendTile(inBackground);
  preemptor.appendNewRule().do().appendTile(setPixelTile);

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

/** Runs the committed binary over the fixed tick schedule with draw and set-pixel taps. */
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

  const drawAction = environment.brainServices.runtime.actions.getById(DRAW_IMAGE);
  assert.ok(drawAction !== undefined && drawAction.binding === "host");
  const execAsync = drawAction.execAsync;
  assert.ok(execAsync !== undefined);
  drawAction.execAsync = (ctx, args, handle) => {
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    execAsync(ctx, args, handle);
    writer.hostActionCallAsync(DRAW_IMAGE, callSiteId, args);
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

/** The 1-based tick index of the last line matching `predicate`, or -1. */
function lastTickOfLine(trace: string, predicate: (line: string) => boolean): number {
  let currentTick = 0;
  let found = -1;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 10);
    } else if (predicate(line)) {
      found = currentTick;
    }
  }
  return found;
}

test("the committed draw-image-background-immediately binary and observable trace golden are byte-stable", () => {
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

  // Both draws paint: the holder, then the preemptor. The `immediately` modifier
  // preempts the held lease, so two draws cross the port.
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 2);
  // Both children light a pixel.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);

  // Both children run within the first thinks, well before the holder's long
  // hold would complete: the preemptor did not park, and the preemption resolved
  // the holder's await early.
  const lastPixelTick = lastTickOfLine(first, (l) => l.startsWith("port display set-pixel "));
  const holderCompletionTick = Math.ceil((TICK_ADVANCE_MS + HOLDER_SECONDS * 1000) / TICK_ADVANCE_MS);
  assert.ok(lastPixelTick > 0 && lastPixelTick < holderCompletionTick);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
