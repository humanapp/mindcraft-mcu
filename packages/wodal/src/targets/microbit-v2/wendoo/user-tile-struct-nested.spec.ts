/**
 * Golden for a struct-typed field in a user-declared struct type: `sprite
 * {pos: position, hp}` composes the declared `position {x, y}`, a sensor
 * constructs the nested value through both factories, a brain variable stores
 * it (deep copy at both levels), and two consumers observe it past the port
 * boundary - a chained accessor read `[sprite][pos][x]` and a flat accessor
 * read `[sprite][hp]`, each feeding a number actuator's digital write. The
 * serialized binary and the rendered trace are pinned beside this spec; the
 * C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary,
 * replays the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WendooEnvironment } from "@wendoo-lang/core/app";
import type { IBrainTileDef } from "@wendoo-lang/core/brain";
import { mkAccessorTileId, mkVariableFactoryTileId } from "@wendoo-lang/core/brain";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import { type BrainTileFactoryDef, BrainTileOperatorDef } from "@wendoo-lang/core/brain/tiles";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@wendoo-lang/core/runtime";
import {
  type AmbientFile,
  buildCompiledActionBundle,
  qualifiedClassName,
  UserTileProject,
} from "@wendoo-lang/ts-compiler";
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-struct-nested.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-struct-nested.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-struct-nested.ticks.trace", import.meta.url));

const POSITION_IDENTITY = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/position.ts", "Position");
const SPRITE_IDENTITY = qualifiedClassName(TEST_PROJECT_NAMESPACE, "/sprite.ts", "Sprite");

/** The constructed sprite: pos = {x: 3, y: 4}, hp = 7. */
const POSITION_X = 3;
const POSITION_Y = 4;
const SPRITE_HP = 7;

/** Pin 8 carries the chained accessor read; pin 9 the flat accessor read. */
const NESTED_PIN = 8;
const HP_PIN = 9;

// The inner struct type, with accessor and variable tiles.
const POSITION_SOURCE = `import { NumberType, StructType, type StructOf } from "wendoo";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: "number" },
  accessors: true,
  variables: true,
});
export type Position = StructOf<typeof Position>;
`;

// The outer struct type: one field is the inner struct, one is a number.
const SPRITE_SOURCE = `import { NumberType, StructType, type StructOf } from "wendoo";
import { Position } from "./position";

export const Sprite = StructType({
  name: "sprite",
  fields: { pos: Position, hp: NumberType },
  accessors: true,
  variables: true,
});
export type Sprite = StructOf<typeof Sprite>;
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

// Constructs the nested value through both factories.
const SPAWN_SOURCE = `import { Sensor, type Context } from "wendoo";
import { Position } from "./position";
import { Sprite } from "./sprite";

export default Sensor({
  name: "spawn sprite",
  inline: true,
  returnType: Sprite,
  onExecute(ctx: Context): Sprite {
    return Sprite({ pos: Position({ x: ${POSITION_X}, y: ${POSITION_Y} }), hp: ${SPRITE_HP} });
  },
});
`;

// Mirrors a number argument to a digital write; fed by the chained accessor read.
const NESTED_WRITE_SOURCE = `import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  name: "user-nested-write",
  args: [param("value", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): void {
    ctx.microbit.gpio.digitalWrite(${NESTED_PIN}, args.value);
  },
});
`;

// Mirrors a number argument to a digital write; fed by the flat accessor read.
const HP_WRITE_SOURCE = `import { Actuator, param, type Context } from "wendoo";

export default Actuator({
  name: "user-hp-write",
  args: [param("value", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): void {
    ctx.microbit.gpio.digitalWrite(${HP_PIN}, args.value);
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

/** Compiles the user code, installs the bundle, and builds the nested-struct rules. */
function buildImage(environment: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["position.ts", POSITION_SOURCE],
      ["sprite.ts", SPRITE_SOURCE],
      ["user-always.ts", SENSOR_SOURCE],
      ["spawn-sprite.ts", SPAWN_SOURCE],
      ["user-nested-write.ts", NESTED_WRITE_SOURCE],
      ["user-hp-write.ts", HP_WRITE_SOURCE],
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
  const positionTypeId = services.runtime.types.resolveByName(POSITION_IDENTITY);
  assert.ok(positionTypeId, "expected the position struct to be registered");
  const spriteTypeId = services.runtime.types.resolveByName(SPRITE_IDENTITY);
  assert.ok(spriteTypeId, "expected the sprite struct to be registered");
  const factory = bundle.tiles.find((tile) => tile.tileId === mkVariableFactoryTileId(spriteTypeId)) as
    | BrainTileFactoryDef
    | undefined;
  assert.ok(factory, "expected the sprite variable factory in the bundle");
  const spriteVar = factory.manufacture(factory, { name: "sprite" });
  assert.ok(spriteVar);
  const accessorPos = bundle.tiles.find((tile) => tile.tileId === mkAccessorTileId(spriteTypeId, "pos"));
  assert.ok(accessorPos, "expected the pos accessor tile in the bundle");
  const accessorHp = bundle.tiles.find((tile) => tile.tileId === mkAccessorTileId(spriteTypeId, "hp"));
  assert.ok(accessorHp, "expected the hp accessor tile in the bundle");
  const accessorX = bundle.tiles.find((tile) => tile.tileId === mkAccessorTileId(positionTypeId, "x"));
  assert.ok(accessorX, "expected the x accessor tile in the bundle");

  const opAssign = new BrainTileOperatorDef("assign", {}, services);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile nested struct brain");
  brainDef.catalog().registerTileDef(spriteVar);
  const page = brainDef.pages().get(0)!;

  // r1: WHEN [user-always] DO [sprite := spawn sprite]
  const rule1 = page.children().get(0)!;
  rule1.when().appendTile(findBundleTile(bundle.tiles, "user-always"));
  rule1.do().appendTile(spriteVar);
  rule1.do().appendTile(opAssign);
  rule1.do().appendTile(findBundleTile(bundle.tiles, "spawn sprite"));

  // r2: DO [user-nested-write [sprite][pos][x]] - the chained accessor read.
  const rule2 = page.appendNewRule();
  assert.ok(rule2);
  rule2.do().appendTile(findBundleTile(bundle.tiles, "user-nested-write"));
  rule2.do().appendTile(spriteVar);
  rule2.do().appendTile(accessorPos);
  rule2.do().appendTile(accessorX);

  // r3: DO [user-hp-write [sprite][hp]] - the flat accessor read.
  const rule3 = page.appendNewRule();
  assert.ok(rule3);
  rule3.do().appendTile(findBundleTile(bundle.tiles, "user-hp-write"));
  rule3.do().appendTile(spriteVar);
  rule3.do().appendTile(accessorHp);

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

test("the committed user-tile nested struct binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-struct-nested.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // Each think: the chained accessor read mirrors pos.x (pin 8) and the flat
  // accessor read mirrors hp (pin 9).
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${NESTED_PIN.toString(16)} ${POSITION_X.toString(16)}`)
      .length,
    SCHEDULE.length
  );
  assert.equal(
    lines.filter((line) => line === `port gpio digital-write ${HP_PIN.toString(16)} ${SPRITE_HP.toString(16)}`).length,
    SCHEDULE.length
  );
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable model recorded the writes in rule order each think.
  assert.deepEqual(
    first.microbit.gpio.recordedDigitalWrites().map((w) => ({ pin: w.pin, value: w.value })),
    [
      { pin: NESTED_PIN, value: POSITION_X },
      { pin: HP_PIN, value: SPRITE_HP },
      { pin: NESTED_PIN, value: POSITION_X },
      { pin: HP_PIN, value: SPRITE_HP },
    ]
  );

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-struct-nested.ticks.trace is not byte-stable");
});
