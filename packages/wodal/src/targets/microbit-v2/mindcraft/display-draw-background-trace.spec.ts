/**
 * Golden observable trace for a REAL compiled brain proving the `in background`
 * modifier on `draw image`: the parent rule fires once on page entry and its DO
 * draws an image for a multi-think duration with the `in background` modifier, so
 * its async handle resolves at dispatch and the parent does not park on the hold.
 * The parent's single child rule lights a pixel; the parent resolves at dispatch
 * and completes its DO, so the child rule drains in the same think as the
 * dispatch (a synchronous cascade), while the draw still holds the display lease.
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
  BrainTileLiteralDef,
  CoreHostActions,
  CoreTypeIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId, WodalMicroBitV2ParameterId } from "./tile-ids";

const BASE = "draw-image-background";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;
const TICK_COUNT = 8;

/** Seconds the parent's draw holds the display, spanning several thinks. */
const HOLD_SECONDS = 3;

/**
 * A one-page brain: a parent rule that fires once on page entry (when) and draws
 * the default image for {@link HOLD_SECONDS} in the background (do, asynchronous
 * with the `in background` modifier), with a single child rule that lights a
 * pixel.
 */
function buildBrainDef(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const drawTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DrawImage.key));
  const durationParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.Duration));
  const inBackground = tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.InBackground));
  const setPixelTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(onPageEntered);
  assert.ok(drawTile);
  assert.ok(durationParam);
  assert.ok(inBackground);
  assert.ok(setPixelTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(onPageEntered);
  parent.do().appendTile(drawTile);
  parent.do().appendTile(durationParam);
  const holdSeconds = new BrainTileLiteralDef(CoreTypeIds.Number, HOLD_SECONDS, {}, env.brainServices);
  brainDef.catalog().registerTileDef(holdSeconds);
  parent.do().appendTile(holdSeconds);
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

/** Runs the committed binary over the fixed tick schedule with the trace observers installed. */
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

  const vmEvents = observableTraceVmEvents(writer);
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
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (predicate(line)) {
      return currentTick;
    }
  }
  return -1;
}

test("the committed draw-image-background binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
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

  // The parent draws once and the child lights one pixel.
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);

  // The parent dispatches its draw on the entry think; because the background
  // draw resolves at dispatch, the parent does not park on the hold and completes
  // its DO, and its child rule (spawned via the compiler-emitted SPAWN_RULE)
  // drains in the same think. The child lights its pixel on the dispatch think
  // while the draw still holds the lease.
  const drawTick = tickOfLine(first, (l) => l.startsWith("port display draw "));
  const pixelTick = tickOfLine(first, (l) => l.startsWith("port display set-pixel "));
  assert.equal(drawTick, 1);
  assert.equal(pixelTick, drawTick);

  // The draw lease genuinely outlasts the child: it holds the display for
  // HOLD_SECONDS, completing several thinks later, so the child ran while the
  // draw was still holding the lease.
  const completionTick = Math.ceil((TICK_ADVANCE_MS + HOLD_SECONDS * 1000) / TICK_ADVANCE_MS);
  assert.ok(completionTick > pixelTick + 1, "the background draw holds the lease past the child's think");

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
