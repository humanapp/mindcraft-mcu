/**
 * Golden for the TS user-code accelerometer surface
 * (`ctx.microbit.accelerometer.*`): a user-tile brain whose actuator reads every
 * accelerometer method and writes each to a display pixel, exercising all eight
 * reads on surface 2. The serialized binary and the rendered trace are pinned
 * beside this spec; the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary, replays the schedule, and byte-compares - confirming
 * the host-function reads agree across VMs.
 *
 * Injected values are whole and non-negative and the derived degrees stay within
 * 0..255, so each read survives the display port's int16/uint8 narrowing
 * identically on both VMs and the recorded pixel values byte-match. The f32
 * precision of the raw reads is covered separately by the port read-back vectors
 * (accelerometer-read-vectors).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-accelerometer-reads.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-accelerometer-reads.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-accelerometer-reads.ticks.trace", import.meta.url));

// A trigger that fires every think (getGesture is always >= 0), so the actuator
// runs each tick regardless of the injected gesture.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.accelerometer.getGesture() >= 0;
  },
});
`;

// Reads each accelerometer method and writes its value to a pixel, surfacing the
// eight reads through the display port.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-show-accelerometer",
  onExecute(ctx: Context): void {
    const accelerometer = ctx.microbit.accelerometer;
    ctx.microbit.display.setPixelValue(0, 0, accelerometer.getX());
    ctx.microbit.display.setPixelValue(1, 0, accelerometer.getY());
    ctx.microbit.display.setPixelValue(2, 0, accelerometer.getZ());
    ctx.microbit.display.setPixelValue(3, 0, accelerometer.getPitch());
    ctx.microbit.display.setPixelValue(4, 0, accelerometer.getRoll());
    ctx.microbit.display.setPixelValue(0, 1, accelerometer.getPitchRadians());
    ctx.microbit.display.setPixelValue(1, 1, accelerometer.getRollRadians());
    ctx.microbit.display.setPixelValue(2, 1, accelerometer.getGesture());
  },
});
`;

/** One scheduled think: accelerometer inputs applied before the time advance. */
interface ScheduleStep {
  readonly advanceMs: number;
  readonly sample?: { readonly x: number; readonly y: number; readonly z: number };
  readonly gesture?: number;
  readonly pitchRadians?: number;
  readonly rollRadians?: number;
}

/**
 * Scripted input, one entry per think. Whole radians (0..4) keep both the radian
 * read and the derived degrees within 0..255. Tick 3 sets nothing, proving every
 * reading holds; ticks 2 and 4 set only some inputs, proving the rest hold.
 */
const SCHEDULE: readonly ScheduleStep[] = [
  { advanceMs: 16, sample: { x: 10, y: 20, z: 30 }, gesture: 11, pitchRadians: 1, rollRadians: 2 },
  { advanceMs: 16, sample: { x: 40, y: 20, z: 30 }, gesture: 3, pitchRadians: 3 },
  { advanceMs: 16 },
  { advanceMs: 16, sample: { x: 40, y: 20, z: 50 }, gesture: 0, rollRadians: 0 },
];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> show-reads image. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-show-accelerometer.ts", ACTUATOR_SOURCE],
    ])
  );
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile accelerometer reads brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(findBundleTile(bundle.tiles, "sensor"));
  rule.do().appendTile(findBundleTile(bundle.tiles, "actuator"));

  const built = buildWodalProgramImage({
    brainDef,
    environment,
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
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment);
  writeFileSync(
    JSON_PATH,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Runs the committed binary over the schedule with the display-port tap installed. */
function runTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of SCHEDULE.entries()) {
    if (step.sample !== undefined) {
      microbit.accelerometer.setSample(step.sample);
    }
    if (step.gesture !== undefined) {
      microbit.accelerometer.setGesture(step.gesture);
    }
    if (step.pitchRadians !== undefined) {
      microbit.accelerometer.setPitchRadians(step.pitchRadians);
    }
    if (step.rollRadians !== undefined) {
      microbit.accelerometer.setRollRadians(step.rollRadians);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile accelerometer-reads binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-accelerometer-reads.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // Eight pixel writes per think (one per accelerometer read), no host-action lines, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, SCHEDULE.length * 8);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // The final think holds x=40, reads gesture 0, and derives roll 0 from 0 radians.
  assert.equal(first.microbit.display.getPixelValue(0, 0), 40);
  assert.equal(first.microbit.display.getPixelValue(2, 1), 0);
  assert.equal(first.microbit.display.getPixelValue(4, 0), 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(TRACE_PATH, "utf8"),
    first.trace,
    "user-tile-accelerometer-reads.ticks.trace is not byte-stable"
  );
});
