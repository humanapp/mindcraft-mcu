/**
 * Golden observable trace for a REAL compiled brain proving the synchronous /
 * asynchronous child-rule discriminator: a parent rule fires once on page entry
 * and lights pixel (0,0). It has two child rules. The synchronous child lights
 * (1,0) with no await, so it drains in the SAME think as the parent. The
 * asynchronous child scrolls text (an async actuator it parks on); its own child
 * rule lights (2,0) at the async child's tail, reached only after the scroll
 * completes, so the grandchild's pixel lands a LATER think. Same-think cascading
 * applies to the synchronous child; AWAIT keeps the asynchronous child's subtree
 * cross-think. The grandchild supplies its pixel column through a parameter tile
 * and literal, so this fixture also pins a param actuator argument in a rule
 * nested under an async-DO subtree.
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

const BASE = "mixed-sync-async-child";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

const TICK_ADVANCE_MS = 1100;
const TICK_COUNT = 12;

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
 * A one-page brain: a parent rule (WHEN on-page-entered) that lights (0,0), with
 * a synchronous child that lights (1,0), and an asynchronous child that scrolls
 * text (parks) whose own child rule lights (2,0) at the async child's tail.
 */
function buildBrainDef(env: WendooEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const scrollTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key));
  assert.ok(onPageEntered);
  assert.ok(scrollTile);

  const setPixel = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(setPixel);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(onPageEntered);
  parent.do().appendTile(setPixel);

  const syncChild = parent.appendNewRule();
  appendSetPixel(env, brainDef, syncChild, 1);

  const asyncChild = parent.appendNewRule();
  asyncChild.do().appendTile(scrollTile);
  const asyncGrandchild = asyncChild.appendNewRule();
  appendSetPixel(env, brainDef, asyncGrandchild, 2);

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

/** The 1-based tick index whose block contains a `set-pixel` at column `xHex`, or -1. */
function pixelTick(trace: string, xHex: string): number {
  return pixelTicksAt(trace, xHex)[0] ?? -1;
}

/** Every 1-based tick index whose block contains a `set-pixel` at column `xHex`, in order. */
function pixelTicksAt(trace: string, xHex: string): number[] {
  const ticks: number[] = [];
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (line.startsWith(`port display set-pixel ${xHex} `)) {
      ticks.push(currentTick);
    }
  }
  return ticks;
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

test("the committed mixed-sync-async-child binary and observable trace golden are byte-stable", () => {
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

  // Column hex constants: x=0 (parent), x=1 (synchronous child), x=2 (async
  // grandchild, supplied through a parameter tile + literal).
  const X0 = "00000000";
  const X1 = "3f800000";
  const X2 = "40000000";

  // Three pixels cross the port: the parent (0,0), the synchronous child (1,0),
  // and the async child's grandchild (2,0).
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 3);
  assert.equal(lines.filter((line) => line.startsWith("port display scroll ")).length, 1);

  const parentTick = pixelTick(first, X0);
  const syncTick = pixelTick(first, X1);
  const asyncTick = pixelTick(first, X2);
  const scrollTick = tickOfLine(first, (l) => l.startsWith("port display scroll "));

  // Each of the three columns is lit exactly once.
  assert.deepEqual(
    [pixelTicksAt(first, X0).length, pixelTicksAt(first, X1).length, pixelTicksAt(first, X2).length],
    [1, 1, 1],
    "the parent, the synchronous child, and the async grandchild each light their column once"
  );

  // The parent, its synchronous child, and the scroll dispatch all land on the
  // entry think: the synchronous child drains in the SAME think as the parent.
  assert.deepEqual(
    [parentTick, syncTick, scrollTick],
    [1, 1, 1],
    "the parent, the synchronous child, and the scroll dispatch all land on the entry think"
  );

  // The asynchronous child parks on its scroll; its grandchild lights (2,0) --
  // its param-supplied column -- only a LATER think, after the animation
  // completes, so a param actuator argument nested under an async-DO subtree
  // lowers and runs correctly. AWAIT stays cross-think.
  assert.ok(asyncTick > 1, "the asynchronous child's grandchild pixel lands a later think than the parent");

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
