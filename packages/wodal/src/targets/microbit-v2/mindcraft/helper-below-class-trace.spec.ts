/**
 * Golden observable trace for module-level call resolution when a helper
 * function is declared below a class, exercised through a real user-tile TS
 * program. The actuator constructs the class, calls a method that itself calls
 * the helper declared below the class, calls the helper directly, then packs
 * every computed scalar into a buffer and surfaces it by writing it to an I2C
 * address. Each call site must land on the function-table slot of the named
 * function regardless of declaration order. The serialized binary and its
 * rendered trace are pinned beside this spec as the cross-VM conformance
 * fixture: the C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the
 * same binary, replays the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, Op, type VmEvents } from "@mindcraft-lang/core/runtime";
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/helper-below-class.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/helper-below-class.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/helper-below-class.ticks.trace", import.meta.url));

/** I2C address the packed-result buffer is written to each think. */
const PROBE_ADDRESS = 0x10;

/** Bytes of the packed result buffer: the field read (40), the method's helper-backed sum (42), and the direct helper call (2). */
const PROBE_HEX = "282a02";

// A trigger that fires every think, so the actuator runs each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Constructs a class declared above a helper it calls, invokes the method and
// the helper directly, then surfaces the computed scalars via I2C.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

class Counter {
  n: number;
  constructor() {
    this.n = 40;
  }
  bump(): number {
    return this.n + two();
  }
}

function two(): number {
  return 2;
}

export default Actuator({
  name: "user-helper-below-class",
  onExecute(ctx: Context): void {
    const c = new Counter();
    ctx.microbit.i2c.writeBuffer(0x10, Buffer.from([c.n, c.bump(), two()]));
  },
});
`;

/** One scheduled think per entry: only the time advance (the brain ignores all input). */
const SCHEDULE: readonly number[] = [16, 16];

/** Opcodes the real compile must emit for this fixture to pin call resolution. */
const REQUIRED_OPCODES: readonly number[] = [Op.STRUCT_NEW, Op.STRUCT_GET_FIELD, Op.CALL];

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

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> helper-below-class rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-helper-below-class.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile helper-below-class brain");
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

test("the committed helper-below-class binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "helper-below-class.mcprogram.bin is not byte-stable");

  // Real expression compilation emits the construction and call opcodes this fixture pins.
  const golden = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number }[] }[] } };
  };
  const opcodes = new Set<number>();
  for (const fn of golden.program.program.functions) {
    for (const ins of fn.code) {
      opcodes.add(ins.op);
    }
  }
  for (const opcode of REQUIRED_OPCODES) {
    assert.ok(opcodes.has(opcode), `compiled bytecode should carry opcode ${opcode}`);
  }

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // One packed result buffer written per think, no host-action lines, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port i2c write ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable bus records the field read, the method call, and the direct helper call.
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
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "helper-below-class.ticks.trace is not byte-stable");
});
