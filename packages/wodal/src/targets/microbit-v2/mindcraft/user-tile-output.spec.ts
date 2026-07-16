/**
 * Golden for sensor output tiles: a user-tile brain whose source sensor declares
 * a numeric `count` output, writes it each think with `setOutput`, and gates the
 * rule; the DO side reads the derived output value-tile and feeds it to a user
 * actuator that writes the value to a 7-bit I2C device. It exercises the full
 * output-tile path end to end - the sensor's `setOutput` lowers to a
 * RuleContextSetVariable host call, the output tile lowers to a
 * RuleContextGetVariable read of the same backing rule variable - reusing the
 * existing rule-variable core functions with no new opcode. The serialized
 * binary and rendered trace are pinned beside this spec so the C++ VM parity
 * test can load the same binary and byte-compare, confirming the output value
 * round-trips identically across VMs.
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-output.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-output.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-output.ticks.trace", import.meta.url));

/** 7-bit address the DO actuator writes the output value to. */
const DEVICE_ADDRESS = 0x10;

/** Fixed value the source sensor writes to its `count` output each think. */
const OUTPUT_VALUE = 42;

// A sensor that fires every think and writes its numeric `count` output.
const SENSOR_SOURCE = `import { Sensor, setOutput, type Context } from "mindcraft";

export default Sensor({
  name: "user-source",
  outputs: [{ name: "count", type: "number" }],
  onExecute(ctx: Context): boolean {
    setOutput(ctx, "count", ${OUTPUT_VALUE});
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// An actuator that writes its numeric argument to the I2C device. The DO side
// fills the argument with the sensor's `count` output value-tile.
const ACTUATOR_SOURCE = `import { Actuator, param, type Context } from "mindcraft";

export default Actuator({
  name: "user-emit",
  args: [param("v", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { v: number }): void {
    ctx.microbit.i2c.writeBuffer(0x10, Buffer.from([args.v]));
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
    { path: "mindcraft.codal.d.ts", content: readText("../../../../ambient/mindcraft.codal.d.ts") },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor" | "output"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile, `expected a ${kind} tile in the bundle`);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the source -> emit(count) rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-source.ts", SENSOR_SOURCE],
      ["user-emit.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile output brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(findBundleTile(bundle.tiles, "sensor"));
  rule.do().appendTile(findBundleTile(bundle.tiles, "actuator"));
  rule.do().appendTile(findBundleTile(bundle.tiles, "output"));

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

/** Runs the committed binary over the schedule with the I2C-port tap installed. */
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
  const deviceWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    writer.i2cWrite(address, data);
    return deviceWrite(address, data);
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

test("the committed user-tile output binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-output.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // The rule writes the output value to I2C once per think; no faults.
  assert.equal(lines.filter((line) => line.startsWith("port i2c write ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The output value written by the sensor must round-trip through the output
  // tile to the actuator and reach the device unchanged.
  const writes = first.microbit.i2c.recordedWrites();
  assert.equal(writes.length, SCHEDULE.length);
  for (const write of writes) {
    assert.equal(write.address, DEVICE_ADDRESS);
    assert.deepEqual(Array.from(write.bytes), [OUTPUT_VALUE]);
  }

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-output.ticks.trace is not byte-stable");
});
