/**
 * Golden observable trace for the light-level sensor tile: a brain pairing the
 * light-level sensor in a rule's when() with the set-pixel actuator in its do().
 * The sensor returns the ambient light level as a 0-255 number, which becomes the
 * WHEN result (truthy while above 0), so the rule fires on each tick the injected
 * level is positive. The scripted schedule covers a dark tick (0, no fire) and two
 * distinct positive levels (fire), driving two set-pixel writes. The serialized
 * binary and the rendered trace are pinned beside this spec as the cross-VM
 * conformance fixtures: the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the binary, replays the same schedule, and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { mkActuatorTileId, mkSensorTileId, type WendooEnvironment } from "@wendoo/core/app";
import { BrainDef } from "@wendoo/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@wendoo/core/runtime";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

/** One scheduled think: the injected light level applied before the time advance. */
interface ScheduleStep {
  readonly advanceMs: number;
  readonly lightLevel: number;
}

// A dark tick (no fire) followed by two distinct positive levels (each fires the
// rule): the sensor's number is truthy while above 0.
const SCHEDULE: readonly ScheduleStep[] = [
  { advanceMs: 16, lightLevel: 0 },
  { advanceMs: 16, lightLevel: 200 },
  { advanceMs: 16, lightLevel: 40 },
];

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/light-level-sensor.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/light-level-sensor.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/light-level-sensor.ticks.trace", import.meta.url));

/** Builds the light-level-sensor -> set-pixel brain image through the tile API. */
function buildFixtureImage(environment: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.LightLevel.key));
  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(sensorTile);
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "light-level-sensor brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);

  const built = buildWodalProgramImage({
    brainDef,
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail("expected a successful build");
  }
  return built.image;
}

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated id. */
function ensureJsonGolden(): void {
  if (existsSync(JSON_PATH)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildFixtureImage(environment);
  writeFileSync(
    JSON_PATH,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Runs the committed binary over the schedule with the observable-trace observers installed. */
function runFixtureTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
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
  for (const [index, step] of SCHEDULE.entries()) {
    microbit.setLightLevel(step.lightLevel);
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed light-level-sensor binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "light-level-sensor.mcprogram.bin is not byte-stable");

  const first = runFixtureTrace(bin);
  const second = runFixtureTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // The two positive-level ticks fire, lighting pixel (0,0); the dark tick does not.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "light-level-sensor.ticks.trace is not byte-stable");
});
