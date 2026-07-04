/**
 * Golden for buffer-as-a-value narrowing: a user-code actuator stores a buffer
 * and a number into rule variables, reads each back as a `MindcraftValue`
 * union, and discriminates them with the `Buffer.isBuffer` type guard. The
 * buffer branch reads `buffer.get(0)` off the narrowed buffer and drives it onto
 * a GPIO pin; the number branch falls through the guard, `typeof`-narrows the
 * same slot to a number, and drives that value onto a second pin. The two pins
 * therefore prove a buffer survives the rule-variable round-trip as a first-
 * class value, `Buffer.isBuffer` narrows it to a usable buffer, and a non-buffer
 * value in the same union is correctly excluded. The serialized binary and the
 * rendered trace are pinned beside this spec; the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the schedule,
 * and byte-compares.
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-buffer-narrowing.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-buffer-narrowing.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-buffer-narrowing.ticks.trace", import.meta.url));

/** Pin the buffer branch drives with the narrowed buffer's first byte. */
const BUFFER_PIN = 2;
/** Pin the number branch drives with the round-tripped number value. */
const NUMBER_PIN = 3;
/** First byte of the stored buffer; the buffer branch writes it to BUFFER_PIN. */
const BUFFER_FIRST_BYTE = 42;
/** Plain number stored alongside the buffer; the number branch writes it to NUMBER_PIN. */
const PLAIN_VALUE = 7;

// A trigger that fires every think, so the actuator runs each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Stores a buffer and a number into rule variables, reads each back as a union
// value, and discriminates them with Buffer.isBuffer: the buffer branch reads
// the narrowed buffer's first byte onto BUFFER_PIN; the number branch typeof-
// narrows the same slot to a number and drives it onto NUMBER_PIN.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-buffer-narrow",
  onExecute(ctx: Context): void {
    ctx.rule.setVariable("payload", Buffer.from([42, 7, 9]));
    const stored = ctx.rule.getVariable("payload");
    if (Buffer.isBuffer(stored)) {
      ctx.microbit.gpio.digitalWrite(2, stored.get(0));
    } else {
      ctx.microbit.gpio.digitalWrite(2, 0);
    }

    ctx.rule.setVariable("plain", 7);
    const other = ctx.rule.getVariable("plain");
    if (Buffer.isBuffer(other)) {
      ctx.microbit.gpio.digitalWrite(3, other.get(0));
    } else {
      ctx.microbit.gpio.digitalWrite(3, typeof other === "number" ? other : 0);
    }
  },
});
`;

/** Two scheduled thinks: only the time advance (the brain ignores all input). */
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

/** Compiles the user tiles, installs them, and builds the trigger -> narrow rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-buffer-narrow.ts", ACTUATOR_SOURCE],
    ])
  );
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  for (const [path, entry] of compileResult.results) {
    assert.deepEqual(entry.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry.diagnostics)}`);
  }
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile buffer narrowing brain");
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
  const deviceWrite = microbit.gpio.digitalWrite.bind(microbit.gpio);
  microbit.gpio.digitalWrite = (pin, value) => {
    writer.gpioDigitalWrite(pin, value);
    return deviceWrite(pin, value);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed buffer-narrowing binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-buffer-narrowing.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);

  // Each think: the buffer branch narrowed the stored buffer and drove its first
  // byte (42 = 0x2a) onto BUFFER_PIN; the number branch excluded the buffer
  // guard, typeof-narrowed the stored number, and drove 7 onto NUMBER_PIN.
  assert.equal(
    lines.filter(
      (line) => line === `port gpio digital-write ${BUFFER_PIN.toString(16)} ${BUFFER_FIRST_BYTE.toString(16)}`
    ).length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${NUMBER_PIN.toString(16)} ${PLAIN_VALUE.toString(16)}`)
      .length,
    SCHEDULE.length
  );

  const writes = first.microbit.gpio.recordedDigitalWrites();
  assert.equal(writes.length, SCHEDULE.length * 2);
  const bufferWrites = writes.filter((write) => write.pin === BUFFER_PIN);
  const numberWrites = writes.filter((write) => write.pin === NUMBER_PIN);
  assert.equal(bufferWrites.length, SCHEDULE.length);
  assert.equal(numberWrites.length, SCHEDULE.length);
  for (const write of bufferWrites) {
    assert.equal(write.value, BUFFER_FIRST_BYTE);
  }
  for (const write of numberWrites) {
    assert.equal(write.value, PLAIN_VALUE);
  }

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(TRACE_PATH, "utf8"),
    first.trace,
    "user-tile-buffer-narrowing.ticks.trace is not byte-stable"
  );
});
