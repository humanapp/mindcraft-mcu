import assert from "node:assert/strict";
import { test } from "node:test";
import { Dict } from "@mindcraft-lang/core";
import {
  type AsyncHandle,
  type ExecutionContext,
  getSlotId,
  List,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkNumberValue,
  mkParameterTileId,
  mkSensorTileId,
  mkStringValue,
  NIL_VALUE,
  type Value,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreTypeIds, type LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { createMicroBitV2ProgramImage } from "./program-image";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId, WodalMicroBitV2ParameterId } from "./tile-ids";

test("microbit-v2 module registers the four button sensors, set-pixel actuator, modifiers, and parameters", () => {
  const env = createMicroBitV2Environment();
  const tiles = env.brainServices.edit.tiles;

  const expectedSensors: readonly [string, string][] = [
    [MicroBitV2HostActions.ButtonA.key, "button A"],
    [MicroBitV2HostActions.ButtonB.key, "button B"],
    [MicroBitV2HostActions.ButtonAB.key, "button A+B"],
    [MicroBitV2HostActions.ButtonLogo.key, "logo"],
  ];
  for (const [key, label] of expectedSensors) {
    const sensorTile = tiles.get(mkSensorTileId(key));
    assert.ok(sensorTile, `${key} sensor tile should be registered`);
    assert.equal(sensorTile.kind, "sensor");
    assert.equal(sensorTile.metadata?.label, label);

    const sensorEntry = env.brainServices.runtime.functions.get(key);
    assert.ok(sensorEntry);
    assert.equal(sensorEntry.isAsync, false);
    // One optional, mutually-exclusive modifier flattens to six arg slots.
    assert.equal(sensorEntry.callDef.argSlots.size(), 6);
  }

  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(actuatorTile, "set-pixel actuator tile should be registered");
  assert.equal(actuatorTile.kind, "actuator");
  assert.equal(actuatorTile.metadata?.label, "set pixel");

  const expectedModifiers: readonly [string, string][] = [
    [WodalMicroBitV2ModifierId.Pressed, "pressed"],
    [WodalMicroBitV2ModifierId.Released, "released"],
    [WodalMicroBitV2ModifierId.Click, "click"],
    [WodalMicroBitV2ModifierId.DoubleClick, "double click"],
    [WodalMicroBitV2ModifierId.LongClick, "long click"],
    [WodalMicroBitV2ModifierId.Held, "held"],
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

  const actuatorEntry = env.brainServices.runtime.functions.get(MicroBitV2HostActions.DisplaySetPixel.key);
  assert.ok(actuatorEntry);
  assert.equal(actuatorEntry.callDef.argSlots.size(), 3);
});

test("set-pixel actuator host function writes the addressed display pixel through the device", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const ctx = createExecutionContext(env, microbit);

  setPixel(env, ctx, { x: 1, y: 2, brightness: 200 });
  assert.equal(microbit.display.getPixelValue(1, 2), 200);

  setPixel(env, ctx, { x: 4, y: 0, brightness: 31 });
  assert.equal(microbit.display.getPixelValue(4, 0), 31);
});

test("set-pixel actuator host state is scoped to the execution context device", () => {
  const firstEnv = createMicroBitV2Environment();
  const secondEnv = createMicroBitV2Environment();
  const firstMicroBit = new MicroBit();
  const secondMicroBit = new MicroBit();

  setPixel(firstEnv, createExecutionContext(firstEnv, firstMicroBit), { x: 0, y: 0, brightness: 51 });
  setPixel(secondEnv, createExecutionContext(secondEnv, secondMicroBit), { x: 0, y: 0, brightness: 127 });

  assert.equal(firstMicroBit.display.getPixelValue(0, 0), 51);
  assert.equal(secondMicroBit.display.getPixelValue(0, 0), 127);
});

test("set-pixel actuator applies parameter defaults when arguments are absent", () => {
  const env = createMicroBitV2Environment();
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

test("scroll actuator is async with optional text, immediately, and in-background slots and defaults the omitted text to 'hello'", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const ctx = createExecutionContext(env, microbit);

  const entry = env.brainServices.runtime.functions.getAsyncById(MicroBitV2HostActions.DisplayScroll.fnId);
  assert.ok(entry, "scroll actuator should be registered as an async function");
  assert.equal(entry.callDef.argSlots.size(), 3);

  let scrolled: string | undefined;
  const deviceScrollText = microbit.display.scrollText.bind(microbit.display);
  microbit.display.scrollText = (text, durationMs, requestTime, onComplete) => {
    scrolled = text;
    deviceScrollText(text, durationMs, requestTime, onComplete);
  };
  const handle: AsyncHandle = { id: 1, resolve: () => {}, reject: () => {}, cancel: () => {} };

  // No text argument: the scroll defaults to "hello".
  entry.fn.exec(ctx, filledArgs(entry.callDef.argSlots.size()), handle);
  assert.equal(scrolled, "hello");

  // An explicit text is scrolled verbatim.
  const args = filledArgs(entry.callDef.argSlots.size());
  args.set(getSlotId(entry.callDef, mkParameterTileId(WodalMicroBitV2ParameterId.Text)), mkStringValue("yo"));
  entry.fn.exec(ctx, args, handle);
  assert.equal(scrolled, "yo");
});

test("default button-A sensor fires on the press edge and does not re-fire while held", () => {
  const env = createMicroBitV2Environment();
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

test("button-A sensor seeds its baseline at page entry without reporting a held level as an edge", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  // The pressed modifier reports the press edge, isolating the page-entry seeding.
  const linkedBrain = buildButtonRuleBrain(env, { x: 3, y: 3, brightness: 99 }, WodalMicroBitV2ModifierId.Pressed);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  // Button already held when the page is first entered: the first evaluation
  // seeds the baseline at the held level, so there is no press edge to report.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(microbit.display.getPixelValue(3, 3), 0);

  // Releasing is not a press edge, so the pressed sensor does not fire.
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(32), undefined);
  assert.equal(microbit.display.getPixelValue(3, 3), 0);

  // A genuine released-to-pressed transition while the page is active fires.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(3, 3), 99);
});

test("button-A long-click modifier fires only when the press lasts at least the long-click threshold", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 0, y: 0, brightness: 120 }, WodalMicroBitV2ModifierId.LongClick);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined); // press at t=32

  // Release at t=1048: the press lasted 1016ms >= 1000ms, so a long click fires.
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(1048), undefined);
  assert.equal(microbit.display.getPixelValue(0, 0), 120);
});

test("button-A long-click modifier does not fire on a short-press click", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 0, y: 0, brightness: 120 }, WodalMicroBitV2ModifierId.LongClick);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined); // press at t=32
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(64), undefined); // release after 32ms: a short click, not a long click
  assert.equal(microbit.display.getPixelValue(0, 0), 0);
});

test("button-A double-click modifier fires when a second press begins within the double-click window", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 2, y: 2, brightness: 80 }, WodalMicroBitV2ModifierId.DoubleClick);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined); // first press
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(48), undefined); // first release -> click at t=48
  assert.equal(microbit.display.getPixelValue(2, 2), 0); // the first press is not a double click

  // Second press at t=64, within 500ms of the click: a double click fires.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(64), undefined);
  assert.equal(microbit.display.getPixelValue(2, 2), 80);
});

test("button-A double-click modifier does not fire when the second press is past the window", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 2, y: 2, brightness: 80 }, WodalMicroBitV2ModifierId.DoubleClick);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined); // first press
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(48), undefined); // click at t=48

  // Second press at t=600, more than 500ms after the click: no double click.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(600), undefined);
  assert.equal(microbit.display.getPixelValue(2, 2), 0);
});

test("button-A held modifier reports a level: true on every pressed tick with no initial delay", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(env, { x: 4, y: 4, brightness: 60 }, WodalMicroBitV2ModifierId.Held);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed, button up
  assert.equal(microbit.display.getPixelValue(4, 4), 0);

  // Pressed: fires on the first pressed tick (no hold threshold).
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined);
  assert.equal(microbit.display.getPixelValue(4, 4), 60);

  // Still pressed: fires again on the next tick.
  microbit.display.clear();
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(4, 4), 60);

  // Released: stops firing, so a cleared pixel stays cleared.
  microbit.setButtonPressed("A", false);
  microbit.display.clear();
  assert.equal(runtime.tick(64), undefined);
  assert.equal(microbit.display.getPixelValue(4, 4), 0);
});

test("button-B sensor reads the button B level for its click", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(
    env,
    { x: 1, y: 1, brightness: 70 },
    undefined,
    MicroBitV2HostActions.ButtonB.key
  );

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed

  // Button A has no effect on the button-B sensor.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined);
  microbit.setButtonPressed("A", false);
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(1, 1), 0);

  // A button-B click fires the rule.
  microbit.setButtonPressed("B", true);
  assert.equal(runtime.tick(64), undefined);
  microbit.setButtonPressed("B", false);
  assert.equal(runtime.tick(80), undefined);
  assert.equal(microbit.display.getPixelValue(1, 1), 70);
});

test("button-A+B sensor treats both buttons pressed as its level and is independent of the single buttons", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(
    env,
    { x: 2, y: 0, brightness: 90 },
    WodalMicroBitV2ModifierId.Pressed,
    MicroBitV2HostActions.ButtonAB.key
  );

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed, both up

  // Only A pressed: the combined level stays released, so no press edge.
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(32), undefined);
  assert.equal(microbit.display.getPixelValue(2, 0), 0);

  // B also pressed: the combined level rises, firing the press edge.
  microbit.setButtonPressed("B", true);
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(2, 0), 90);
});

test("logo sensor reads the capacitive touch level for its click", () => {
  const env = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  const linkedBrain = buildButtonRuleBrain(
    env,
    { x: 0, y: 4, brightness: 110 },
    undefined,
    MicroBitV2HostActions.ButtonLogo.key
  );

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });

  assert.equal(runtime.tick(16), undefined); // seed

  // A logo touch then release completes a click and fires the rule.
  microbit.setLogoTouched(true);
  assert.equal(runtime.tick(32), undefined);
  microbit.setLogoTouched(false);
  assert.equal(runtime.tick(48), undefined);
  assert.equal(microbit.display.getPixelValue(0, 4), 110);
});

test("button-A sensor with the released modifier fires on the pressed-to-released edge", () => {
  const env = createMicroBitV2Environment();
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
  modifierId?: string,
  sensorKey: string = MicroBitV2HostActions.ButtonA.key
): LinkedBrainProgram {
  const tiles = env.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(sensorKey));
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
    services: {
      ...(env.brainServices as unknown as Record<string, unknown>),
      // Minimal rule-variable surface so actuators that read getWhenResult
      // (e.g. scroll text) resolve to NIL outside a real rule scope.
      brain: { ruleVars: { getByName: () => NIL_VALUE, setByName: () => {} } },
    } as unknown as ExecutionContext["services"],
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    getSystemVarBySlot: () => NIL_VALUE,
    setSystemVarBySlot: () => {},
    data: { microbit },
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}
