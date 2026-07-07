/**
 * Golden observable trace for the list and map container opcodes, exercised
 * through a real user-tile TS program. The actuator builds a list and a map,
 * mutates and reads them back through the container operations, type-guards both
 * handles, packs every computed scalar into a buffer, and surfaces that buffer by
 * writing it to an I2C address, so the results cross the observable I2C port. The
 * container opcodes are emitted by real expression compilation (the ts-compiler),
 * not hand-authored. The serialized binary and its rendered trace are pinned
 * beside this spec as the cross-VM container conformance fixture: the C++ VM
 * parity test (cpp/test/trace-parity.test.cpp) loads the same binary, replays the
 * schedule, and byte-compares.
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/container-ops.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/container-ops.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/container-ops.ticks.trace", import.meta.url));

/** I2C address the packed-result buffer is written to each think. */
const PROBE_ADDRESS = 0x20;

/**
 * Bytes of the packed result buffer: list length (3), list[1] (20), popped tail
 * via `?? 0` (30), map.get(1) via `?? 0` (4), map.has(2) (1), map.has(1) after
 * delete (0). The `?? 0` nil-guards emit the TYPE_CHECK opcode.
 */
const PROBE_HEX = "03141e040100";

// A trigger that fires every think, so the actuator runs each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Exercises the list and map opcodes, then surfaces the computed scalars via I2C.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-container-ops",
  onExecute(ctx: Context): void {
    const list: number[] = [];
    list.push(10);
    list.push(20);
    list.push(30);
    const len = list.length;
    const at1 = list[1];
    const poppedVal = list.pop() ?? 0;

    const map = new Map<number, number>();
    map.set(1, 4);
    map.set(2, 2);
    const g1Val = map.get(1) ?? 0;
    const has2 = map.has(2);
    map.delete(1);
    const has1 = map.has(1);

    const probe = Buffer.from([len, at1, poppedVal, g1Val, has2 ? 1 : 0, has1 ? 1 : 0]);
    ctx.microbit.i2c.writeBuffer(0x20, probe);
  },
});
`;

/** One scheduled think per entry: only the time advance (the brain ignores all input). */
const SCHEDULE: readonly number[] = [16, 16];

// Container opcodes the real compile must emit for this fixture to cover them.
// Element reads (`list[i]`) lower to a host-function call, so LIST_GET is not
// reachable from user TS and is not pinned here.
const REQUIRED_OPCODES: readonly number[] = [
  Op.LIST_NEW,
  Op.LIST_PUSH,
  Op.LIST_LEN,
  Op.LIST_POP,
  Op.MAP_NEW,
  Op.MAP_SET,
  Op.MAP_GET,
  Op.MAP_HAS,
  Op.MAP_DELETE,
  Op.TYPE_CHECK,
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

/** Compiles the user tiles, installs them, and builds the trigger -> container-ops rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-container-ops.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile container ops brain");
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

test("the committed container-ops binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "container-ops.mcprogram.bin is not byte-stable");

  // Real expression compilation emits the container opcodes this fixture pins.
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
    assert.ok(opcodes.has(opcode), `compiled bytecode should carry container opcode ${opcode}`);
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

  // The injectable bus records the exact address and packed bytes each think wrote.
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
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "container-ops.ticks.trace is not byte-stable");
});
