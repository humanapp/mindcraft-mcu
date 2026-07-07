/**
 * Golden observable trace for enum-valued user tiles compiled from TS user
 * code and executed by a cold-loaded VM (a fresh runtime that decodes the
 * committed binary, with none of the compile session's registrations). The
 * WHEN sensor's onExecute returns an enum imported from another module,
 * derived through an enum `!==` comparison and an enum-typed ternary (enum
 * values are always truthy, so the rule fires every think); the DO actuator
 * imports the same enum and derives each probe byte from an enum `===` or
 * `!==` comparison, so a comparison that faults or misevaluates changes the
 * bytes written to the I2C address. The serialized binary and its rendered
 * trace are pinned beside this spec as the cross-VM conformance fixture: the
 * C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary,
 * replays the schedule, and byte-compares.
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-enum-return.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-enum-return.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-enum-return.ticks.trace", import.meta.url));

/** I2C address the enum-comparison probe buffer is written to each think. */
const PROBE_ADDRESS = 0x10;

/**
 * Bytes of the probe buffer written each time the enum WHEN result fires:
 * byte 0 comes from a true enum `===`, byte 1 from a true enum `!==`.
 */
const PROBE_HEX = "0201";

/** The registered identity of the shared enum, pinned inside the artifact. */
const ENUM_QUALIFIED_NAME = `${TEST_PROJECT_NAMESPACE}:/mode-defs.ts::Mode`;

// The module the sensor imports the enum from.
const DEFS_SOURCE = `export enum Mode {
  Stop = 0,
  Go = 2,
}
`;

// The WHEN trigger: derives the imported enum through a `!==` comparison and
// an enum-typed ternary; enum values are truthy, so the rule fires every
// think.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Mode } from "./mode-defs";

function advance(m: Mode): Mode {
  return m !== Mode.Stop ? Mode.Go : Mode.Stop;
}

export default Sensor({
  name: "user-mode",
  onExecute(ctx: Context): Mode {
    return advance(Mode.Go);
  },
});
`;

// Surfaces each firing of the enum-triggered rule via I2C; each probe byte is
// decided by an enum comparison.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";
import { Mode } from "./mode-defs";

function firstByte(m: Mode): number {
  return m === Mode.Go ? 2 : 9;
}

function secondByte(m: Mode): number {
  return m !== Mode.Stop ? 1 : 9;
}

export default Actuator({
  name: "user-enum-probe",
  onExecute(ctx: Context): void {
    ctx.microbit.i2c.writeBuffer(0x10, Buffer.from([firstByte(Mode.Go), secondByte(Mode.Go)]));
  },
});
`;

/** One scheduled think per entry: only the time advance (the brain ignores all input). */
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

/** Compiles the user tiles, installs them, and builds the enum-sensor -> enum-probe rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["mode-defs.ts", DEFS_SOURCE],
      ["user-mode.ts", SENSOR_SOURCE],
      ["user-enum-probe.ts", ACTUATOR_SOURCE],
    ])
  );
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const sensorProgram = compileResult.results.get("user-mode.ts")?.program;
  assert.ok(sensorProgram, "the enum-returning sensor compiles");
  assert.equal(
    sensorProgram.outputType,
    environment.brainServices.runtime.types.resolveByName(ENUM_QUALIFIED_NAME),
    "the sensor's output type is the imported enum's registered type"
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile enum-return brain");
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

test("the committed user-tile-enum-return binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-enum-return.mcprogram.bin is not byte-stable");

  // The artifact carries the enum under its module-qualified identity.
  assert.ok(
    readFileSync(JSON_PATH, "utf8").includes(ENUM_QUALIFIED_NAME),
    "the golden program embeds the enum's qualified type name"
  );

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // One probe buffer written per think (the enum WHEN result is truthy), no
  // host-action lines, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port i2c write ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable bus records the matching and non-matching enum comparisons.
  const writes = first.microbit.i2c.recordedWrites();
  assert.equal(writes.length, SCHEDULE.length);
  for (const write of writes) {
    assert.equal(write.address, PROBE_ADDRESS);
    assert.equal(
      Array.from(write.bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      PROBE_HEX
    );
  }

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-enum-return.ticks.trace is not byte-stable");
});
