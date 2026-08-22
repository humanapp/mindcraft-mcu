/**
 * Golden for a user-declared struct type: a `StructType({...})` declaration
 * (`position {x, y}` with accessor and variable tiles), a sensor returning the
 * type through its binding reference, and two consumers observing the value
 * past the port boundary - a user actuator receiving the struct through an
 * anonymous param (field reads in user code) and a number actuator fed by a
 * brain-side accessor tile read from a struct variable (STRUCT_GET_FIELD in
 * the brain program). The serialized binary and the rendered trace are pinned
 * beside this spec; the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary, replays the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WendooEnvironment } from "@wendoo/core/app";
import type { IBrainTileDef } from "@wendoo/core/brain";
import { mkAccessorTileId, mkVariableFactoryTileId } from "@wendoo/core/brain";
import { BrainDef } from "@wendoo/core/brain/model";
import { type BrainTileFactoryDef, BrainTileOperatorDef } from "@wendoo/core/brain/tiles";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@wendoo/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, qualifiedClassName, UserTileProject } from "@wendoo/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@wendoo/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-struct.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-struct.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-struct.ticks.trace", import.meta.url));

const POSITION_IDENTITY = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/position.ts", "Position");

/** The declared position: x = 3, y = 4. */
const POSITION_X = 3;
const POSITION_Y = 4;

/** Pin 8 carries the packed fields from user code; pin 9 the accessor read. */
const PACKED_PIN = 8;
const ACCESSOR_PIN = 9;
const PACKED_WRITE = POSITION_X * 100 + POSITION_Y;

// The declared struct type, with accessor and variable tiles.
const POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "wendoo";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
  accessors: true,
  variables: true,
});
export type Position = StructOf<typeof Position>;
`;

// A trigger that fires every think.
const SENSOR_SOURCE = `import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Produces the declared struct through the binding reference and factory.
const STICK_SOURCE = `import { Sensor, type Context } from "wendoo";
import { Position } from "./position";

export default Sensor({
  name: "stick position",
  inline: true,
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: ${POSITION_X}, y: ${POSITION_Y} });
  },
});
`;

// Receives the struct through an anonymous param and mirrors the packed
// fields to a digital write, observable past the port boundary.
const PACKET_WRITE_SOURCE = `import { Actuator, param, type Context } from "wendoo";
import { Position } from "./position";

export default Actuator({
  name: "user-position-write",
  args: [param("pos", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { pos: Position }): void {
    ctx.microbit.gpio.digitalWrite(${PACKED_PIN}, args.pos.x * 100 + args.pos.y);
  },
});
`;

// Mirrors a number argument to a digital write; fed by an accessor tile read.
const NUMBER_WRITE_SOURCE = `import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  name: "user-number-write",
  args: [param("value", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): void {
    ctx.microbit.gpio.digitalWrite(${ACCESSOR_PIN}, args.value);
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

function findBundleTile(tiles: readonly IBrainTileDef[], label: string): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.metadata?.label === label);
  assert.ok(tile, `bundle tile "${label}" not found`);
  return tile;
}

/** Compiles the user code, installs the bundle, and builds the struct-producing rules. */
function buildImage(environment: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["position.ts", POSITION_SOURCE],
      ["user-always.ts", SENSOR_SOURCE],
      ["stick-position.ts", STICK_SOURCE],
      ["user-position-write.ts", PACKET_WRITE_SOURCE],
      ["user-number-write.ts", NUMBER_WRITE_SOURCE],
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

  const services = environment.brainServices;
  const typeId = services.runtime.types.resolveByName(POSITION_IDENTITY);
  assert.ok(typeId, "expected the position struct to be registered");
  const factory = bundle.tiles.find((tile) => tile.tileId === mkVariableFactoryTileId(typeId)) as
    | BrainTileFactoryDef
    | undefined;
  assert.ok(factory, "expected the position variable factory in the bundle");
  const posVar = factory.manufacture(factory, { name: "pos" });
  assert.ok(posVar);
  const accessorX = bundle.tiles.find((tile) => tile.tileId === mkAccessorTileId(typeId, "x"));
  assert.ok(accessorX, "expected the x accessor tile in the bundle");

  const opAssign = new BrainTileOperatorDef("assign", {}, services);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile struct brain");
  brainDef.catalog().registerTileDef(posVar);
  const page = brainDef.pages().get(0)!;

  // r1: WHEN [user-always] DO [pos := stick position]
  const rule1 = page.children().get(0)!;
  rule1.when().appendTile(findBundleTile(bundle.tiles, "user-always"));
  rule1.do().appendTile(posVar);
  rule1.do().appendTile(opAssign);
  rule1.do().appendTile(findBundleTile(bundle.tiles, "stick position"));

  // r2: DO [user-position-write [pos]] - the struct crosses the action boundary.
  const rule2 = page.appendNewRule();
  assert.ok(rule2);
  rule2.do().appendTile(findBundleTile(bundle.tiles, "user-position-write"));
  rule2.do().appendTile(posVar);

  // r3: DO [user-number-write [pos][x]] - the accessor read feeds a number slot.
  const rule3 = page.appendNewRule();
  assert.ok(rule3);
  rule3.do().appendTile(findBundleTile(bundle.tiles, "user-number-write"));
  rule3.do().appendTile(posVar);
  rule3.do().appendTile(accessorX);

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

/** Runs the committed binary over the schedule with the GPIO write tap installed. */
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

test("the committed user-tile struct binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-struct.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // Each think: user code packs the struct fields (pin 8) and the brain-side
  // accessor read mirrors x (pin 9).
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${PACKED_PIN.toString(16)} ${PACKED_WRITE.toString(16)}`)
      .length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${ACCESSOR_PIN.toString(16)} ${POSITION_X.toString(16)}`)
      .length,
    SCHEDULE.length
  );
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable model recorded the writes in rule order each think.
  assert.deepEqual(
    first.microbit.gpio.recordedDigitalWrites().map((w) => ({ pin: w.pin, value: w.value })),
    [
      { pin: PACKED_PIN, value: PACKED_WRITE },
      { pin: ACCESSOR_PIN, value: POSITION_X },
      { pin: PACKED_PIN, value: PACKED_WRITE },
      { pin: ACCESSOR_PIN, value: POSITION_X },
    ]
  );

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-struct.ticks.trace is not byte-stable");
});
