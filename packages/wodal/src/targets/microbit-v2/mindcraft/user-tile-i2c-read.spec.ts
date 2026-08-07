/**
 * Golden for the TS user-code I2C read surface (`ctx.microbit.i2c.readBuffer`):
 * a user-tile brain whose actuator reads bytes from an injected responder and
 * writes them straight back to the bus, exercising the first surface-2
 * host-function that returns a runtime-allocated managed `Buffer`. Writing the
 * read result back proves the managed `Buffer` carries the injected bytes end to
 * end (the write line echoes them). A second read of an address with no
 * responder exercises the no-device path (an empty `Buffer`). The serialized
 * binary and the rendered trace are pinned beside this spec; the C++ VM parity
 * test (cpp/test/trace-parity.test.cpp) loads the same binary, replays the
 * schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-i2c-read.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-i2c-read.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-i2c-read.ticks.trace", import.meta.url));

/** 7-bit address with an injected responder, and the bytes it returns. */
const RESPONDER_ADDRESS = 0x42;
const RESPONDER_BYTES = [0xaa, 0xbb, 0xcc] as const;

/** 7-bit address the read bytes are echoed to, so the write line proves them. */
const ECHO_ADDRESS = 0x10;

/** 7-bit address with no responder (a no-device read) and its echo address. */
const ABSENT_ADDRESS = 0x55;
const ABSENT_ECHO_ADDRESS = 0x11;

// A trigger that fires every think, so the actuator reads each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Reads from each address and echoes the bytes straight back to the bus.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-i2c-read",
  onExecute(ctx: Context): void {
    ctx.microbit.i2c.writeBuffer(0x10, ctx.microbit.i2c.readBuffer(0x42, 3));
    ctx.microbit.i2c.writeBuffer(0x11, ctx.microbit.i2c.readBuffer(0x55, 2));
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
      content: readText("../../../../../../external/mindcraft-lang/packages/core/lib/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.codal.d.ts", content: readText("../../../../lib/mindcraft.codal.d.ts") },
    {
      path: "mindcraft.microbit-v2.d.ts",
      content: readText("../../../../targets/microbit-v2/lib/mindcraft.microbit-v2.d.ts"),
    },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> i2c-read rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-i2c-read.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile i2c read brain");
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

/** Runs the committed binary over the schedule with the I2C-port taps installed. */
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
  const deviceRead = microbit.i2c.read.bind(microbit.i2c);
  microbit.i2c.read = (address, length) => {
    const bytes = deviceRead(address, length);
    writer.i2cRead(address, length, bytes);
    return bytes;
  };
  const deviceWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    writer.i2cWrite(address, data);
    return deviceWrite(address, data);
  };

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  // Loading the program clears the device, so inject the responder after the load.
  microbit.i2c.setReadResponse(RESPONDER_ADDRESS, Uint8Array.from(RESPONDER_BYTES));

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile i2c-read binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-i2c-read.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // One responder read + one no-device read per think, each echoed by a write.
  assert.equal(
    lines.filter((line) => line === `port i2c read ${RESPONDER_ADDRESS.toString(16)} 3 aabbcc`).length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port i2c read ${ABSENT_ADDRESS.toString(16)} 2 `).length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port i2c write ${ECHO_ADDRESS.toString(16)} aabbcc`).length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port i2c write ${ABSENT_ECHO_ADDRESS.toString(16)} `).length,
    SCHEDULE.length
  );
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The echoed writes carry the managed Buffer the read returned: the responder
  // bytes for the responder address, an empty buffer for the no-device read.
  const writes = first.microbit.i2c.recordedWrites();
  assert.equal(writes.length, SCHEDULE.length * 2);
  for (let i = 0; i < writes.length; i += 2) {
    assert.equal(writes[i]?.address, ECHO_ADDRESS);
    assert.deepEqual(Array.from(writes[i]?.bytes ?? []), [...RESPONDER_BYTES]);
    assert.equal(writes[i + 1]?.address, ABSENT_ECHO_ADDRESS);
    assert.deepEqual(Array.from(writes[i + 1]?.bytes ?? []), []);
  }

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-i2c-read.ticks.trace is not byte-stable");
});
