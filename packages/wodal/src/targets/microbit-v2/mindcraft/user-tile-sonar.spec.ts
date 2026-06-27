/**
 * Golden for the TS user-code sonar surface (`ctx.microbit.sonar`): a user-tile
 * brain whose actuator reads one pin-keyed sonar twice each think. The two reads
 * share one cached measurement, and the cached value carries a fixed one-cycle
 * lag - the registration think reads the initial max distance, and the next
 * think reads the previous cycle's injected measurement. The serialized binary
 * and the rendered trace are pinned beside this spec; the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the schedule,
 * and byte-compares - confirming the cached sonar read crosses the background
 * sensor driver identically across VMs.
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
import { SONAR_MAX_DISTANCE_CM } from "../../../core/sensor-driver";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-sonar.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-sonar.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-sonar.ticks.trace", import.meta.url));

/** Cutebot sonar wiring: trigger on P8, echo on P12. */
const TRIG_PIN = 8;
const ECHO_PIN = 12;

/** Injected echo width and the distance the SR04 formula yields for it. */
const ECHO_MICROS = 5000;
const MEASURED_CM = Math.floor((ECHO_MICROS * 34) / 2 / 1000);

// A trigger that fires every think, so the actuator reads the sonar each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Reads the same pin-keyed sonar twice; both reads share the one cached
// measurement for the think.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-sonar",
  onExecute(ctx: Context): void {
    ctx.microbit.sonar.distance(8, 12);
    ctx.microbit.sonar.distance(8, 12);
  },
});
`;

/** Two scheduled thinks: the first reads the initial value, the second the measurement. */
const SCHEDULE: readonly number[] = [16, 16];

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

/** Compiles the user tiles, installs them, and builds the trigger -> sonar rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-sonar.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile sonar brain");
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

/** Runs the committed binary over the schedule with the sonar-read tap installed. */
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
  const deviceDistance = microbit.sensorDriver.sonarDistance.bind(microbit.sensorDriver);
  microbit.sensorDriver.sonarDistance = (trig, echo) => {
    const cm = deviceDistance(trig, echo);
    writer.sonarDistance(trig, echo, cm);
    return cm;
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  // Loading the program clears the device, so inject the echo width after the load.
  microbit.sensorDriver.setEchoMicros(TRIG_PIN, ECHO_PIN, ECHO_MICROS);

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile sonar binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-sonar.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);

  const trig = TRIG_PIN.toString(16);
  const echo = ECHO_PIN.toString(16);
  // The first think registers the sonar; both of its reads return the initial
  // max distance. Every later think's reads return the previous cycle's
  // measurement. Two reads per think share the one cached value.
  assert.equal(
    lines.filter((line) => line === `port sonar distance ${trig} ${echo} ${SONAR_MAX_DISTANCE_CM.toString(16)}`).length,
    2
  );
  assert.equal(
    lines.filter((line) => line === `port sonar distance ${trig} ${echo} ${MEASURED_CM.toString(16)}`).length,
    2 * (SCHEDULE.length - 1)
  );
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-sonar.ticks.trace is not byte-stable");
});
