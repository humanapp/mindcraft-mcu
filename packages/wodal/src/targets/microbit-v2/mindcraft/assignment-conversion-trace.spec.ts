/**
 * Golden observable trace for implicit conversions at assignment and unary
 * operand positions, exercised through a real compiled brain. The brain
 * assigns a Boolean literal to a Number variable (variable-target
 * conversion), assigns a String literal to a struct's Number field
 * (field-target conversion), and negates a Number literal with [not]
 * (unary-operand conversion feeding a call-arg conversion). Each converted
 * value is surfaced past the port boundary as a GPIO digital write. The
 * serialized binary and its rendered trace are pinned beside this spec as the
 * cross-VM conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the
 * schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { mkAccessorTileId, mkVariableFactoryTileId } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  type BrainTileFactoryDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import {
  CoreFuncId,
  CoreTypeIds,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  Op,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/assignment-conversion.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/assignment-conversion.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/assignment-conversion.ticks.trace", import.meta.url));

const POSITION_IDENTITY = "/position.ts::Position";

/** Pin 9 surfaces the variable-target write, pin 10 the field-target write, pin 11 the unary result. */
const VARIABLE_PIN = 9;
const FIELD_PIN = 10;
const UNARY_PIN = 11;

/** [true] assigned to a Number variable converts to 1. */
const VARIABLE_WRITE = 1;
/** ["37"] assigned to the struct's Number field converts to 37. */
const FIELD_WRITE = 37;
/** [not] [0] converts the operand to Boolean (false), negates it, and the Number arg slot converts true to 1. */
const UNARY_WRITE = 1;

// The declared struct type, with accessor and variable tiles.
const POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
  accessors: true,
  variables: true,
});
export type Position = StructOf<typeof Position>;
`;

// A trigger that fires every think.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Produces the declared struct so the brain has a struct to write a field of.
const STICK_SOURCE = `import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "stick position",
  returnType: Position,
  onExecute(ctx: Context): Position {
    return Position({ x: 3, y: 4 });
  },
});
`;

// One reporter per surfaced value: each mirrors its Number argument to a
// fixed pin, observable past the port boundary.
function reporterSource(name: string, pin: number): string {
  return `import { Actuator, param, type Context } from "mindcraft";

export default Actuator({
  name: "${name}",
  args: [param("value", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): void {
    ctx.microbit.gpio.digitalWrite(${pin}, args.value);
  },
});
`;
}

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

function findBundleTile(tiles: readonly IBrainTileDef[], label: string): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.metadata?.label === label);
  assert.ok(tile, `bundle tile "${label}" not found`);
  return tile;
}

/** Compiles the user code, installs the bundle, and builds the conversion-exercising rules. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      ["position.ts", POSITION_SOURCE],
      ["user-always.ts", SENSOR_SOURCE],
      ["stick-position.ts", STICK_SOURCE],
      ["report-variable.ts", reporterSource("report variable", VARIABLE_PIN)],
      ["report-field.ts", reporterSource("report field", FIELD_PIN)],
      ["report-unary.ts", reporterSource("report unary", UNARY_PIN)],
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

  const numVar = new BrainTileVariableDef("golden.conv.numVar", "n", CoreTypeIds.Number, "golden-conv-num");
  const boolLit = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, services);
  const strLit = new BrainTileLiteralDef(CoreTypeIds.String, "37", {}, services);
  const zeroLit = new BrainTileLiteralDef(CoreTypeIds.Number, 0, {}, services);
  const opAssign = new BrainTileOperatorDef("assign", {}, services);
  const opNot = new BrainTileOperatorDef("not", {}, services);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "assignment conversion brain");
  brainDef.catalog().registerTileDef(posVar);
  brainDef.catalog().registerTileDef(numVar);
  const page = brainDef.pages().get(0)!;

  // r1: WHEN [user-always] DO [pos := stick position] -- seeds the struct.
  const rule1 = page.children().get(0)!;
  rule1.when().appendTile(findBundleTile(bundle.tiles, "user-always"));
  rule1.do().appendTile(posVar);
  rule1.do().appendTile(opAssign);
  rule1.do().appendTile(findBundleTile(bundle.tiles, "stick position"));

  // r2: DO [n] [=] [true] -- variable target, Boolean -> Number conversion.
  const rule2 = page.appendNewRule();
  assert.ok(rule2);
  rule2.do().appendTile(numVar);
  rule2.do().appendTile(opAssign);
  rule2.do().appendTile(boolLit);

  // r3: DO [pos][x] [=] ["37"] -- field target, String -> Number conversion.
  const rule3 = page.appendNewRule();
  assert.ok(rule3);
  rule3.do().appendTile(posVar);
  rule3.do().appendTile(accessorX);
  rule3.do().appendTile(opAssign);
  rule3.do().appendTile(strLit);

  // r4: DO [report variable [n]] -- surfaces the converted variable.
  const rule4 = page.appendNewRule();
  assert.ok(rule4);
  rule4.do().appendTile(findBundleTile(bundle.tiles, "report variable"));
  rule4.do().appendTile(numVar);

  // r5: DO [report field [pos][x]] -- surfaces the converted field.
  const rule5 = page.appendNewRule();
  assert.ok(rule5);
  rule5.do().appendTile(findBundleTile(bundle.tiles, "report field"));
  rule5.do().appendTile(posVar);
  rule5.do().appendTile(accessorX);

  // r6: DO [report unary [not] [0]] -- the unary operand converts Number ->
  // Boolean, and the Number arg slot converts the result back.
  const rule6 = page.appendNewRule();
  assert.ok(rule6);
  rule6.do().appendTile(findBundleTile(bundle.tiles, "report unary"));
  rule6.do().appendTile(opNot);
  rule6.do().appendTile(zeroLit);

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

test("the committed assignment-conversion binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "assignment-conversion.mcprogram.bin is not byte-stable");

  // Real expression compilation emits the conversion host calls this fixture
  // pins: Boolean -> Number (variable target and unary result arg),
  // String -> Number (field target), Number -> Boolean (unary operand), and
  // the id-based struct field store.
  const golden = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number; a?: number }[] }[] } };
  };
  const seen = golden.program.program.functions.flatMap((fn) => fn.code);
  const requires: readonly { op: number; a?: number }[] = [
    { op: Op.HOST_CALL, a: CoreFuncId.ConvBooleanToNumber },
    { op: Op.HOST_CALL, a: CoreFuncId.ConvStringToNumber },
    { op: Op.HOST_CALL, a: CoreFuncId.ConvNumberToBoolean },
    { op: Op.STRUCT_SET_FIELD },
  ];
  for (const required of requires) {
    assert.ok(
      seen.some((ins) => ins.op === required.op && (required.a === undefined || ins.a === required.a)),
      `compiled bytecode should carry op ${required.op}${required.a === undefined ? "" : ` func ${required.a}`}`
    );
  }

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // Three converted values surface per think, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port gpio digital-write ")).length, 3 * SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable model recorded the converted values in rule order each think.
  assert.deepEqual(
    first.microbit.gpio.recordedDigitalWrites().map((w) => ({ pin: w.pin, value: w.value })),
    [
      { pin: VARIABLE_PIN, value: VARIABLE_WRITE },
      { pin: FIELD_PIN, value: FIELD_WRITE },
      { pin: UNARY_PIN, value: UNARY_WRITE },
      { pin: VARIABLE_PIN, value: VARIABLE_WRITE },
      { pin: FIELD_PIN, value: FIELD_WRITE },
      { pin: UNARY_PIN, value: UNARY_WRITE },
    ]
  );

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "assignment-conversion.ticks.trace is not byte-stable");
});
