/**
 * Golden for the TS user-code GPIO surface (`ctx.microbit.gpio`): a user-tile
 * brain whose actuator reads an injected pin and drives the four simple pin ops
 * (digital read, digital write, pull config, servo write) each think, plus an
 * out-of-range pin that traces but records nothing. The serialized binary and
 * the rendered trace are pinned beside this spec; the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the schedule,
 * and byte-compares - confirming the pin ops cross the GPIO port identically
 * across VMs.
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-gpio.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-gpio.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-gpio.ticks.trace", import.meta.url));

/** Line-sensor pin read each think, and the level injected onto it. */
const SENSOR_PIN = 13;
const SENSOR_LEVEL = 1;

/** Output pin the read level is mirrored to. */
const OUTPUT_PIN = 2;

/** Gripper servo pin and the angle written to it. */
const SERVO_PIN = 1;
const SERVO_ANGLE = 90;

/** A pin outside 0-20: the write traces but records nothing. */
const OUT_OF_RANGE_PIN = 99;

// A trigger that fires every think, so the actuator drives the pins each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Reads the line-sensor pin, mirrors it to an output pin, sets a pull on the
// sensor pin, drives the gripper servo, and writes one out-of-range pin.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-gpio",
  onExecute(ctx: Context): void {
    const level = ctx.microbit.gpio.digitalRead(13);
    ctx.microbit.gpio.digitalWrite(2, level);
    ctx.microbit.gpio.setPull(13, 0);
    ctx.microbit.gpio.servoWrite(1, 90);
    ctx.microbit.gpio.digitalWrite(99, 1);
  },
});
`;

/** One scheduled think: only the time advance (the brain ignores all input). */
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

/** Compiles the user tiles, installs them, and builds the trigger -> gpio rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-gpio.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile gpio brain");
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
  const deviceRead = microbit.gpio.digitalRead.bind(microbit.gpio);
  microbit.gpio.digitalRead = (pin) => {
    const value = deviceRead(pin);
    writer.gpioDigitalRead(pin, value);
    return value;
  };
  const deviceWrite = microbit.gpio.digitalWrite.bind(microbit.gpio);
  microbit.gpio.digitalWrite = (pin, value) => {
    writer.gpioDigitalWrite(pin, value);
    return deviceWrite(pin, value);
  };
  const deviceSetPull = microbit.gpio.setPull.bind(microbit.gpio);
  microbit.gpio.setPull = (pin, mode) => {
    writer.gpioSetPull(pin, mode);
    return deviceSetPull(pin, mode);
  };
  const deviceSetServo = microbit.gpio.setServo.bind(microbit.gpio);
  microbit.gpio.setServo = (pin, angle) => {
    writer.gpioServoWrite(pin, angle);
    return deviceSetServo(pin, angle);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  // Loading the program clears the device, so inject the sensor level after the load.
  microbit.gpio.setDigitalRead(SENSOR_PIN, SENSOR_LEVEL);

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile gpio binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-gpio.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // One read + three in-range writes (digital/servo) + one pull + one out-of-range
  // write per think, all traced; no host-action lines, no faults.
  assert.equal(
    lines.filter((line) => line === `port gpio digital-read ${SENSOR_PIN.toString(16)} ${SENSOR_LEVEL.toString(16)}`)
      .length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${OUTPUT_PIN.toString(16)} ${SENSOR_LEVEL.toString(16)}`)
      .length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio set-pull ${SENSOR_PIN.toString(16)} 0`).length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio servo-write ${SERVO_PIN.toString(16)} ${SERVO_ANGLE.toString(16)}`)
      .length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${OUT_OF_RANGE_PIN.toString(16)} 1`).length,
    SCHEDULE.length
  );
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable model records the in-range writes/pull/servo and served the
  // injected read; the out-of-range pin recorded nothing.
  const writes = first.microbit.gpio.recordedDigitalWrites();
  assert.equal(writes.length, SCHEDULE.length);
  for (const write of writes) {
    assert.equal(write.pin, OUTPUT_PIN);
    assert.equal(write.value, SENSOR_LEVEL);
  }
  const pulls = first.microbit.gpio.recordedPulls();
  assert.equal(pulls.length, SCHEDULE.length);
  for (const pull of pulls) {
    assert.equal(pull.pin, SENSOR_PIN);
    assert.equal(pull.mode, 0);
  }
  const servos = first.microbit.gpio.recordedServos();
  assert.equal(servos.length, SCHEDULE.length);
  for (const servo of servos) {
    assert.equal(servo.pin, SERVO_PIN);
    assert.equal(servo.angle, SERVO_ANGLE);
  }

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-gpio.ticks.trace is not byte-stable");
});
