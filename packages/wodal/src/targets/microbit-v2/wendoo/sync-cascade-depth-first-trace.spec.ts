/**
 * Golden observable trace for a REAL compiled brain proving the synchronous
 * child-rule cascade: a parent rule and its whole subtree run within ONE think,
 * in depth-first causal order. The parent fires once on page entry and its DO
 * lights pixel x=0. It has two child rules: the first (x=1) itself has a
 * grandchild rule (x=2); the second child lights x=3. Because child rules drain
 * synchronously in the same think as their parent, and the drain is depth-first,
 * the four pixels land in one tick in the order x = 0, 1, 2, 3 (parent, first
 * child, that child's grandchild, then the second child). A breadth-first drain
 * would light 0, 1, 3, 2; a next-think cascade would spread the pixels across
 * four ticks.
 *
 * The brain is built through the tile API and compiled by the brain compiler, so
 * the parent's child invocations are compiler-emitted SPAWN_RULEs. The JSON,
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
  mkActuatorTileId,
  mkParameterTileId,
  mkSensorTileId,
  type WendooEnvironment,
} from "@wendoo-lang/core/app";
import { BrainDef, type BrainRuleDef } from "@wendoo-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@wendoo-lang/core/runtime";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ParameterId } from "./tile-ids";

const BASE = "sync-cascade-depth-first";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

const TICK_ADVANCE_MS = 1000;
const TICK_COUNT = 4;

/** Appends `set pixel` at column `x` (row 0) to `rule`'s DO, freezing `x` as a literal tile. */
function appendSetPixel(env: WendooEnvironment, brainDef: BrainDef, rule: BrainRuleDef, x: number): void {
  const tiles = env.brainServices.edit.tiles;
  const setPixel = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  const xParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.X));
  assert.ok(setPixel);
  assert.ok(xParam);
  rule.do().appendTile(setPixel);
  rule.do().appendTile(xParam);
  const xLiteral = new BrainTileLiteralDef(CoreTypeIds.Number, x, {}, env.brainServices);
  brainDef.catalog().registerTileDef(xLiteral);
  rule.do().appendTile(xLiteral);
}

/**
 * A one-page brain: a parent rule (WHEN on-page-entered) that lights x=0, with a
 * first child (x=1) that itself has a grandchild (x=2), and a second child (x=3).
 */
function buildBrainDef(env: WendooEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  assert.ok(onPageEntered);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(onPageEntered);
  appendSetPixel(env, brainDef, parent, 0);

  const firstChild = parent.appendNewRule();
  appendSetPixel(env, brainDef, firstChild, 1);

  const grandchild = firstChild.appendNewRule();
  appendSetPixel(env, brainDef, grandchild, 2);

  const secondChild = parent.appendNewRule();
  appendSetPixel(env, brainDef, secondChild, 3);

  return brainDef;
}

function buildImage(env: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
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

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated ids. */
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
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

/** The x coordinate (as f32 hex) of each `set-pixel` line, in trace order. */
function pixelColumnsInOrder(trace: string): string[] {
  const columns: string[] = [];
  for (const line of trace.split("\n")) {
    if (line.startsWith("port display set-pixel ")) {
      columns.push(line.split(" ")[3]!);
    }
  }
  return columns;
}

/** The 1-based tick index of every block that contains a `set-pixel` line. */
function pixelTicks(trace: string): number[] {
  const ticks: number[] = [];
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (line.startsWith("port display set-pixel ")) {
      ticks.push(currentTick);
    }
  }
  return ticks;
}

test("the committed sync-cascade-depth-first binary and observable trace golden are byte-stable", () => {
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

  // Column hex constants: x=0 is 00000000, x=1 is 3f800000, x=2 is 40000000,
  // x=3 is 40400000.
  const X0 = "00000000";
  const X1 = "3f800000";
  const X2 = "40000000";
  const X3 = "40400000";

  // The whole cascade lights four pixels exactly once (the parent WHEN fires only
  // on the entry think).
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 4);

  // Same-think: every pixel lands in tick 1. A next-think cascade would spread
  // the four pixels across four ticks.
  assert.deepEqual(pixelTicks(first), [1, 1, 1, 1], "the whole synchronous subtree runs in one think");

  // Depth-first causal order: parent (x=0), first child (x=1), that child's
  // grandchild (x=2), then the second child (x=3). Breadth-first would be
  // 0, 1, 3, 2.
  assert.deepEqual(pixelColumnsInOrder(first), [X0, X1, X2, X3], "the drain is depth-first, not breadth-first");

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
