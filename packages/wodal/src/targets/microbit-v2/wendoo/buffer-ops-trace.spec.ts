/**
 * Golden observable trace for the Buffer value type and its builtin host
 * functions, exercised through a real user-tile TS program. The actuator
 * constructs three buffers - from a number list, from a hex string, and from a
 * latin1 string - reads two of them back through `length()` and `get(i)`, packs
 * those reads into a fourth buffer, and surfaces every buffer by writing it to a
 * distinct I2C address, so each managed buffer crosses the observable I2C port
 * and renders as its bytes. The buffer opcodes are emitted by real expression
 * compilation (the ts-compiler), not hand-authored. The serialized binary and
 * its rendered trace are pinned beside this spec as the cross-VM buffer
 * conformance fixture: the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary, replays the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WendooEnvironment } from "@wendoo-lang/core/app";
import type { IBrainTileDef } from "@wendoo-lang/core/brain";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import { CoreFuncId, type LinkedBrainProgram, linkedBrainProgramToJson, Op } from "@wendoo-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@wendoo-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@wendoo-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/buffer-ops.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/buffer-ops.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/buffer-ops.ticks.trace", import.meta.url));

/** Buffers each think writes, keyed by their target I2C address. */
const EXPECTED_WRITES: readonly { address: number; hex: string }[] = [
  { address: 0x10, hex: "0a141e" }, // Buffer.from([10, 20, 30])
  { address: 0x11, hex: "00ff7f" }, // Buffer.fromHex("00ff7f")
  { address: 0x12, hex: "4869" }, // Buffer.fromString("Hi")
  { address: 0x13, hex: "03140048" }, // [list.length(), list.get(1), hex.get(0), str.get(0)]
];

// A trigger that fires every think, so the actuator writes each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Builds buffers three ways, reads two back, and surfaces each through I2C.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "wendoo";

export default Actuator({
  name: "user-buffer-ops",
  onExecute(ctx: Context): void {
    const fromList = Buffer.from([10, 20, 30]);
    const fromHex = Buffer.fromHex("00ff7f");
    const fromStr = Buffer.fromString("Hi");
    const probe = Buffer.from([fromList.length(), fromList.get(1), fromHex.get(0), fromStr.get(0)]);
    ctx.microbit.i2c.writeBuffer(0x10, fromList);
    ctx.microbit.i2c.writeBuffer(0x11, fromHex);
    ctx.microbit.i2c.writeBuffer(0x12, fromStr);
    ctx.microbit.i2c.writeBuffer(0x13, probe);
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
      path: "wendoo.core.d.ts",
      content: readText("../../../../../../external/wendoo-lang/packages/core/lib/wendoo.core.d.ts"),
    },
    { path: "wendoo.codal.d.ts", content: readText("../../../../lib/wendoo.codal.d.ts") },
    {
      path: "wendoo.microbit-v2.d.ts",
      content: readText("../../../../targets/microbit-v2/lib/wendoo.microbit-v2.d.ts"),
    },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> buffer-ops rule. */
function buildImage(environment: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-buffer-ops.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile buffer ops brain");
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

  const vmEvents = observableTraceVmEvents(writer);
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

test("the committed buffer-ops binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "buffer-ops.mcprogram.bin is not byte-stable");

  // Real expression compilation emits the buffer builtins this fixture pins.
  const golden = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number; a?: number }[] }[] } };
  };
  const hostCallFuncIds = new Set<number>();
  for (const fn of golden.program.program.functions) {
    for (const ins of fn.code) {
      if (ins.op === Op.HOST_CALL && ins.a !== undefined) {
        hostCallFuncIds.add(ins.a);
      }
    }
  }
  for (const funcId of [
    CoreFuncId.BufferFrom,
    CoreFuncId.BufferFromHex,
    CoreFuncId.BufferFromString,
    CoreFuncId.BufferLength,
    CoreFuncId.BufferGet,
  ]) {
    assert.ok(hostCallFuncIds.has(funcId), `compiled bytecode should call buffer builtin ${funcId}`);
  }

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // Four buffers written per think, no host-action lines, no faults.
  assert.equal(
    lines.filter((line) => line.startsWith("port i2c write ")).length,
    SCHEDULE.length * EXPECTED_WRITES.length
  );
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable bus records the exact address and bytes each buffer carried.
  const writes = first.microbit.i2c.recordedWrites();
  assert.equal(writes.length, SCHEDULE.length * EXPECTED_WRITES.length);
  for (const [index, write] of writes.entries()) {
    const expected = EXPECTED_WRITES[index % EXPECTED_WRITES.length];
    assert.equal(write.address, expected.address);
    assert.equal(
      Array.from(write.bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      expected.hex
    );
  }

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "buffer-ops.ticks.trace is not byte-stable");
});
