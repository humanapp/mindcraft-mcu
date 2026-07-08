/**
 * Golden for the TS user-code GPIO analog surface (`ctx.microbit.gpio.analogRead`):
 * a user-tile brain whose actuator reads two injected analog pins each think and
 * mirrors their sum to a digital write, proving the values enter the VM. The
 * injection schedule exercises the ADC boundaries (0 and 1023), a mid value, two
 * independently injected pins, and that an injected value holds until changed.
 * The serialized binary and the rendered trace are pinned beside this spec; the
 * C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary,
 * replays the schedule, and byte-compares - confirming the analog reads cross
 * the GPIO port identically across VMs.
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
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-gpio-analog.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-gpio-analog.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-gpio-analog.ticks.trace", import.meta.url));

/** Stick-axis pins read each think. */
const VERTICAL_PIN = 1;
const HORIZONTAL_PIN = 2;

/** Injection schedule: boundary values before think 1, a mid value before think 2. */
const VERTICAL_START = 0;
const HORIZONTAL_START = 1023;
const VERTICAL_MID = 512;

/** Output pin the sum of both reads is mirrored to. */
const OUTPUT_PIN = 8;

// A trigger that fires every think, so the actuator reads the pins each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Reads both stick-axis pins and mirrors their sum to a digital write, so the
// read values are observable past the port boundary.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-gpio-analog",
  onExecute(ctx: Context): void {
    const vertical = ctx.microbit.gpio.analogRead(1);
    const horizontal = ctx.microbit.gpio.analogRead(2);
    ctx.microbit.gpio.digitalWrite(8, vertical + horizontal);
  },
});
`;

/** Three scheduled thinks: only the time advance (the brain ignores all input). */
const SCHEDULE: readonly number[] = [16, 16, 16];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.wodal.d.ts", content: readText("../../../../ambient/mindcraft.wodal.d.ts") },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> analog-read rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-gpio-analog.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile gpio analog brain");
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

/** Runs the committed binary over the schedule with the GPIO-port taps installed. */
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
  const deviceAnalogRead = microbit.gpio.analogRead.bind(microbit.gpio);
  microbit.gpio.analogRead = (pin) => {
    const value = deviceAnalogRead(pin);
    writer.gpioAnalogRead(pin, value);
    return value;
  };
  const deviceWrite = microbit.gpio.digitalWrite.bind(microbit.gpio);
  microbit.gpio.digitalWrite = (pin, value) => {
    writer.gpioDigitalWrite(pin, value);
    return deviceWrite(pin, value);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  // Loading the program clears the device, so inject the axis values after the load.
  microbit.gpio.setAnalogRead(VERTICAL_PIN, VERTICAL_START);
  microbit.gpio.setAnalogRead(HORIZONTAL_PIN, HORIZONTAL_START);

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    if (index === 1) {
      // Only the vertical axis is re-injected; the horizontal value must hold.
      microbit.gpio.setAnalogRead(VERTICAL_PIN, VERTICAL_MID);
    }
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile gpio analog binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-gpio-analog.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // Think 1 reads the boundary values; thinks 2 and 3 read the mid value on the
  // re-injected vertical pin and the held boundary value on the horizontal pin.
  assert.equal(
    lines.filter((line) => line === `port gpio analog-read ${VERTICAL_PIN.toString(16)} ${VERTICAL_START.toString(16)}`)
      .length,
    1
  );
  assert.equal(
    lines.filter((line) => line === `port gpio analog-read ${VERTICAL_PIN.toString(16)} ${VERTICAL_MID.toString(16)}`)
      .length,
    2
  );
  assert.equal(
    lines.filter(
      (line) => line === `port gpio analog-read ${HORIZONTAL_PIN.toString(16)} ${HORIZONTAL_START.toString(16)}`
    ).length,
    SCHEDULE.length
  );
  // The mirrored digital write carries each think's sum, proving the read
  // values flowed through the compiled brain.
  assert.equal(
    lines.filter(
      (line) =>
        line ===
        `port gpio digital-write ${OUTPUT_PIN.toString(16)} ${(VERTICAL_START + HORIZONTAL_START).toString(16)}`
    ).length,
    1
  );
  assert.equal(
    lines.filter(
      (line) =>
        line === `port gpio digital-write ${OUTPUT_PIN.toString(16)} ${(VERTICAL_MID + HORIZONTAL_START).toString(16)}`
    ).length,
    2
  );
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable model recorded the mirrored sums in think order.
  assert.deepEqual(
    first.microbit.gpio.recordedDigitalWrites().map((w) => ({ pin: w.pin, value: w.value })),
    [
      { pin: OUTPUT_PIN, value: VERTICAL_START + HORIZONTAL_START },
      { pin: OUTPUT_PIN, value: VERTICAL_MID + HORIZONTAL_START },
      { pin: OUTPUT_PIN, value: VERTICAL_MID + HORIZONTAL_START },
    ]
  );

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-gpio-analog.ticks.trace is not byte-stable");
});
