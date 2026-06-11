import assert from "node:assert/strict";
import { test } from "node:test";
import { Dict } from "@mindcraft-lang/core";
import {
  coreModule,
  createMindcraftEnvironment,
  type ExecutionContext,
  getSlotId,
  List,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkNumberValue,
  mkParameterTileId,
  mkSensorTileId,
  NIL_VALUE,
  type Value,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds, type LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { MicroBit } from "../microbit";
import { createMicroBitV2Module } from "./module";
import { createMicroBitV2ProgramImage } from "./program-image";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId, WodalMicroBitV2ParameterId } from "./tile-ids";

test("microbit-v2 module registers the button-A sensor, set-pixel actuator, modifiers, and parameters", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const tiles = env.brainServices.edit.tiles;

  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key));
  assert.ok(sensorTile, "button-A sensor tile should be registered");
  assert.equal(sensorTile.kind, "sensor");
  assert.equal(sensorTile.metadata?.label, "button A");

  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(actuatorTile, "set-pixel actuator tile should be registered");
  assert.equal(actuatorTile.kind, "actuator");
  assert.equal(actuatorTile.metadata?.label, "set pixel");

  const expectedModifiers: readonly [string, string][] = [
    [WodalMicroBitV2ModifierId.Pressed, "pressed"],
    [WodalMicroBitV2ModifierId.Released, "released"],
  ];
  for (const [modifierId, label] of expectedModifiers) {
    const modifierTile = tiles.get(mkModifierTileId(modifierId));
    assert.ok(modifierTile, `modifier tile ${modifierId} should be registered`);
    assert.equal(modifierTile.kind, "modifier");
    assert.equal(modifierTile.metadata?.label, label);
  }

  for (const parameterId of [
    WodalMicroBitV2ParameterId.X,
    WodalMicroBitV2ParameterId.Y,
    WodalMicroBitV2ParameterId.Brightness,
  ]) {
    const parameterTile = tiles.get(mkParameterTileId(parameterId));
    assert.ok(parameterTile, `parameter tile ${parameterId} should be registered`);
    assert.equal(parameterTile.kind, "parameter");
  }

  const sensorEntry = env.brainServices.runtime.functions.get(MicroBitV2HostActions.ButtonA.key);
  assert.ok(sensorEntry);
  assert.equal(sensorEntry.isAsync, false);
  assert.equal(sensorEntry.callDef.argSlots.size(), 2);

  const actuatorEntry = env.brainServices.runtime.functions.get(MicroBitV2HostActions.DisplaySetPixel.key);
  assert.ok(actuatorEntry);
  assert.equal(actuatorEntry.callDef.argSlots.size(), 3);
});

test("set-pixel actuator host function writes the addressed display pixel through the device", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const ctx = createExecutionContext(env, microbit);

  setPixel(env, ctx, { x: 1, y: 2, brightness: 200 });
  assert.equal(microbit.display.getPixelValue(1, 2), 200);

  setPixel(env, ctx, { x: 4, y: 0, brightness: 31 });
  assert.equal(microbit.display.getPixelValue(4, 0), 31);
});

test("set-pixel actuator host state is scoped to the execution context device", () => {
  const firstEnv = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const secondEnv = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const firstMicroBit = new MicroBit();
  const secondMicroBit = new MicroBit();

  setPixel(firstEnv, createExecutionContext(firstEnv, firstMicroBit), { x: 0, y: 0, brightness: 51 });
  setPixel(secondEnv, createExecutionContext(secondEnv, secondMicroBit), { x: 0, y: 0, brightness: 127 });

  assert.equal(firstMicroBit.display.getPixelValue(0, 0), 51);
  assert.equal(secondMicroBit.display.getPixelValue(0, 0), 127);
});

test("set-pixel actuator applies parameter defaults when arguments are absent", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const ctx = createExecutionContext(env, microbit);
  const entry = getSyncFunctionEntry(env, MicroBitV2HostActions.DisplaySetPixel.key);

  // No arguments: x and y default to 0, brightness defaults to 255.
  entry.fn.exec(ctx, filledArgs(entry.callDef.argSlots.size()));
  assert.equal(microbit.display.getPixelValue(0, 0), 255);

  // An explicit brightness of 0 is preserved and turns the pixel off.
  setPixel(env, ctx, { x: 0, y: 0, brightness: 0 });
  assert.equal(microbit.display.getPixelValue(0, 0), 0);
});

test("default button-A sensor fires on the released-to-pressed edge and does not re-fire while held", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 1, y: 2, brightness: 200 });

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  // Baseline: button up, no edge.
  assert.equal(runtime.tick(16), undefined);
  assert.equal(microbit.display.getPixelValue(1, 2), 0);

  // Released-to-pressed edge fires once.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined);
  assert.equal(microbit.display.getPixelValue(1, 2), 200);

  // Still held: no re-fire, so a cleared pixel stays cleared.
  microbit.display.clear();
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(1, 2), 0);
});

test("button-A sensor does not report an edge when the button is already held as the page is entered", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 3, y: 3, brightness: 99 });

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  // Button already held when the page is first entered: the first evaluation
  // seeds the baseline at the held level, so there is no edge to report.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(microbit.display.getPixelValue(3, 3), 0);

  // Releasing is not a pressed edge, so it does not fire either.
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(32), undefined);
  assert.equal(microbit.display.getPixelValue(3, 3), 0);

  // A genuine release-to-press transition while the page is active fires.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(3, 3), 99);
});

test("button-A sensor with the released modifier fires on the pressed-to-released edge", () => {
  const env = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 0, y: 0, brightness: 150 }, WodalMicroBitV2ModifierId.Released);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined);
  assert.equal(microbit.display.getPixelValue(0, 0), 0);

  // Pressing is the wrong edge for the released modifier: no fire.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined);
  assert.equal(microbit.display.getPixelValue(0, 0), 0);

  // Releasing fires.
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(0, 0), 150);
});

interface PixelOptions {
  readonly x: number;
  readonly y: number;
  readonly brightness: number;
}

function setPixel(env: MindcraftEnvironment, ctx: ExecutionContext, options: PixelOptions): void {
  const entry = getSyncFunctionEntry(env, MicroBitV2HostActions.DisplaySetPixel.key);
  const args = filledArgs(entry.callDef.argSlots.size());
  args.set(getSlotId(entry.callDef, mkParameterTileId(WodalMicroBitV2ParameterId.X)), mkNumberValue(options.x));
  args.set(getSlotId(entry.callDef, mkParameterTileId(WodalMicroBitV2ParameterId.Y)), mkNumberValue(options.y));
  args.set(
    getSlotId(entry.callDef, mkParameterTileId(WodalMicroBitV2ParameterId.Brightness)),
    mkNumberValue(options.brightness)
  );
  entry.fn.exec(ctx, args);
}

function buildButtonRuleBrain(
  env: MindcraftEnvironment,
  options: PixelOptions,
  modifierId?: string
): LinkedBrainProgram {
  const tiles = env.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key));
  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(sensorTile);
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "button display brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  if (modifierId !== undefined) {
    const modifierTile = tiles.get(mkModifierTileId(modifierId));
    assert.ok(modifierTile, `modifier tile ${modifierId} should be registered`);
    rule.when().appendTile(modifierTile);
  }

  rule.do().appendTile(actuatorTile);
  // Named parameters are filled by the parameter tile followed by its value tile.
  const namedArgs: readonly [string, number][] = [
    [WodalMicroBitV2ParameterId.X, options.x],
    [WodalMicroBitV2ParameterId.Y, options.y],
    [WodalMicroBitV2ParameterId.Brightness, options.brightness],
  ];
  for (const [parameterId, value] of namedArgs) {
    const parameterTile = tiles.get(mkParameterTileId(parameterId));
    assert.ok(parameterTile, `parameter tile ${parameterId} should be registered`);
    rule.do().appendTile(parameterTile);
    const literal = new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, env.brainServices);
    brainDef.catalog().registerTileDef(literal);
    rule.do().appendTile(literal);
  }

  const brain = env.createBrain(brainDef);
  const program = brain.getProgram();
  assert.ok(program);
  const linkedBrain: LinkedBrainProgram = {
    program,
    ruleIndex: new Dict<string, number>(),
    pages: brain.getPages(),
  };
  brain.dispose();
  return linkedBrain;
}

function getSyncFunctionEntry(env: MindcraftEnvironment, name: string) {
  const entry = env.brainServices.runtime.functions.get(name);
  assert.ok(entry, `function '${name}' should be registered`);
  assert.equal(entry.isAsync, false);
  return entry;
}

function filledArgs(size: number): List<Value> {
  const args = List.empty<Value>();
  for (let i = 0; i < size; i++) {
    args.push(NIL_VALUE);
  }
  return args;
}

function createExecutionContext(env: MindcraftEnvironment, microbit: MicroBit): ExecutionContext {
  return {
    services: env.brainServices as unknown as ExecutionContext["services"],
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    data: { microbit },
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}
