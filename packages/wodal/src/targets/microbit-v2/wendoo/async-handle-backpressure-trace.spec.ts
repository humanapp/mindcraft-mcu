/**
 * Golden observable trace for a REAL compiled brain proving async-dispatch
 * backpressure on handle exhaustion. A parent rule fires once on page entry and
 * lights pixel x=0; it has EIGHT child rules, each of which scrolls text (an
 * asynchronous display action). Child rules drain synchronously in the parent's
 * think, so all eight attempt their async scroll dispatch in one think -- an
 * async breadth of eight.
 *
 * The brain runs under a small handle cap (4). The first four dispatches fill the
 * cap (the first takes the display lease and stays pending; the next three drop
 * against the busy display but still hold a settled slot until the think
 * boundary). The fifth dispatch onward finds no free handle and parks: each
 * re-executes its identical dispatch on a later think, with no fault. The breadth
 * spills across thinks in bounded waves (4, then 3, then 1), the live handle count
 * never exceeds the cap, and no scroll dispatch is lost.
 *
 * The brain is built through the tile API and compiled by the brain compiler, so
 * the parent's child invocations are compiler-emitted SPAWN_RULEs. The JSON,
 * binary, and rendered trace are pinned beside this spec as the cross-VM
 * conformance fixture: the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary under the same cap and byte-compares the trace.
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
} from "@wendoo/core/app";
import { BrainDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import {
  BrainRuntime,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  type PlatformServices,
} from "@wendoo/core/runtime";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { MicroBitV2HostActions, WodalMicroBitV2ParameterId } from "./tile-ids";

const BASE = "async-handle-backpressure";
const JSON_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram`, import.meta.url));
const BIN_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.mcprogram.bin`, import.meta.url));
const TRACE_PATH = fileURLToPath(new URL(`./__fixtures__/${BASE}.ticks.trace`, import.meta.url));

/** Handle cap the brain runs under; below the device profile's 8 concurrent handles. */
const MAX_HANDLES = 4;
/** Number of async-scroll child rules under the parent (the same-think async breadth). */
const CHILD_COUNT = 8;
const TICK_ADVANCE_MS = 1100;
const TICK_COUNT = 9;

/**
 * A one-page brain: a parent rule (WHEN on-page-entered) that lights pixel x=0,
 * with {@link CHILD_COUNT} child rules that each scroll text asynchronously.
 */
function buildBrainDef(env: WendooEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const setPixel = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  const xParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.X));
  const scrollTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key));
  assert.ok(onPageEntered);
  assert.ok(setPixel);
  assert.ok(xParam);
  assert.ok(scrollTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${BASE} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(onPageEntered);
  parent.do().appendTile(setPixel);
  parent.do().appendTile(xParam);
  const xLiteral = new BrainTileLiteralDef(CoreTypeIds.Number, 0, {}, env.brainServices);
  brainDef.catalog().registerTileDef(xLiteral);
  parent.do().appendTile(xLiteral);

  for (let i = 0; i < CHILD_COUNT; i++) {
    const child = parent.appendNewRule();
    child.do().appendTile(scrollTile);
  }

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

function hostServicesOf(environment: WendooEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/** Runs the committed binary over the fixed tick schedule under the small handle cap. */
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
  const brain = new BrainRuntime(
    decoded.program.program,
    decoded.program.pages,
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
      maxHandles: MAX_HANDLES,
    }
  );
  brain.startup();

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + TICK_ADVANCE_MS;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    microbit.sleep(TICK_ADVANCE_MS);
    brain.think(timeMs);
    // Settle any scroll whose animation time has arrived, resolving its handle so
    // the awaiting child resumes on the next think.
    microbit.display.advanceScroll(microbit.systemTime());
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

/**
 * The count of async host-action dispatches (lines ending in `async`) in each
 * tick block, in order. Scroll is the brain's only async action, so each such
 * line is one child's scroll dispatch.
 */
function scrollDispatchesPerTick(trace: string): number[] {
  const perTick: number[] = [];
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      perTick.push(0);
    } else if (line.endsWith(" async")) {
      perTick[perTick.length - 1]!++;
    }
  }
  return perTick;
}

test("the committed async-handle-backpressure binary and observable trace golden are byte-stable", () => {
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

  // No dispatch faults: handle exhaustion parks and retries, it never faults.
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0, "backpressure must never fault");

  // Every one of the CHILD_COUNT child rules eventually dispatches its scroll --
  // no async action is lost to the cap. Scroll is the only async action, so each
  // async-suffixed line is one scroll dispatch.
  const scrollAsyncLines = lines.filter((line) => line.endsWith(" async"));
  assert.equal(scrollAsyncLines.length, CHILD_COUNT, "every child rule's async scroll eventually dispatches");

  // The breadth spills across thinks in bounded waves that never exceed the cap:
  // 4 in the entry think, then 3, then 1. No wave dispatches more than MAX_HANDLES.
  const waves = scrollDispatchesPerTick(first).filter((count) => count > 0);
  assert.deepEqual(waves, [4, 3, 1], "the async breadth drains in bounded waves under the cap");
  for (const count of waves) {
    assert.ok(count <= MAX_HANDLES, "no wave dispatches more concurrent async than the handle cap");
  }

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, `${BASE}.ticks.trace is not byte-stable`);
});
