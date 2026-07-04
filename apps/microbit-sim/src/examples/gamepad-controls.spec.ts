/**
 * Headless compile-and-run validation for the Yahboom gamepad's controls and
 * its `position` struct type. It compiles the shipped gamepad tiles into real
 * brains, runs them on the WODAL microbit-v2 runtime with injected analog and
 * digital pin values, and observes what each tile reports: direction/button
 * firings via observer actuators that mark an I2C address, and exact normalized
 * position fields mirrored to digital writes through the accessor tiles.
 *
 * It pins the vendor direction bands, the rescaled dead zone, press dominance,
 * modifier OR-matching, the color-to-pin button mapping, the exact centered and
 * normalized position values, and the three exposures a `StructType`
 * declaration grants: a tile `returnType`, the derived accessor tiles (offered
 * in the picker and read), and the variable factory (create, store, read back).
 * The position -> Buffer conversion's picker reach is checked here too.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { List } from "@mindcraft-lang/core";
import { BrainDef, BrainTileModifierDef, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { type IBrainTileDef, mkAccessorTileId, mkVariableFactoryTileId, RuleSide } from "@mindcraft-lang/core/brain";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@mindcraft-lang/core/brain/language-service";
import { type BrainTileFactoryDef, BrainTileOperatorDef } from "@mindcraft-lang/core/brain/tiles";
import type { LinkedBrainProgram, TypeId } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { createMicroBitV2Environment, MicroBit, WodalMicroBitRuntime } from "@mindcraft-lang/wodal/targets/microbit-v2";

/** Stick analog axes: pin 1 vertical, pin 2 horizontal. */
const VERTICAL_PIN = 1;
const HORIZONTAL_PIN = 2;
/** Digital pull-up lines: press and the four colored buttons; idle reads HIGH (1). */
const PRESS_PIN = 8;
const RED_PIN = 13;
const GREEN_PIN = 14;
const BLUE_PIN = 15;
const YELLOW_PIN = 16;
const HIGH = 1;
const LOW = 0;

/** Measured rest readings (centered stick) for each axis. */
const VERTICAL_REST = 500;
const HORIZONTAL_REST = 502;

/** 7-bit I2C address the marker observers write to, and the two the position observers mirror to. */
const OBSERVER_ADDRESS = 0x50;
const OBS_X_ADDRESS = 0x60;
const OBS_Y_ADDRESS = 0x61;

/**
 * Offset the position observers add before writing a value as an I2C byte, so a
 * signed -100..100 field travels as an unsigned 0..200 byte (the same bias the
 * wire packet uses); the reader subtracts it back.
 */
const OBSERVER_BIAS = 100;

/** The position struct's symbol identity, keyed `<file>::<binding>`. */
const POSITION_IDENTITY = "/position.ts::Position";

/** Marker bytes an observer actuator writes so a firing can be attributed to its rule. */
const MARK = {
  up: 0x01,
  down: 0x02,
  left: 0x03,
  right: 0x04,
  bare: 0x05,
  upLeft: 0x06,
  red: 0x11,
  green: 0x12,
  blue: 0x13,
  yellow: 0x14,
  anyButton: 0x15,
  redBlue: 0x16,
} as const;

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function microbitAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    {
      path: "mindcraft.microbit-v2.d.ts",
      content: readText("../../../../packages/wodal/ambient/mindcraft.microbit-v2.d.ts"),
    },
  ];
}

/** An always-true trigger, so a rule driving it fires every think its page is active. */
const ALWAYS_SOURCE = `import { type Context, Sensor } from "mindcraft";

export default Sensor({
  name: "always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

/** A test-only actuator that marks a firing by writing one byte to the observer address. */
function observerSource(name: string, marker: number): string {
  return `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: ${JSON.stringify(name)},
  onExecute(ctx: Context): void {
    ctx.microbit.i2c.writeBuffer(${OBSERVER_ADDRESS}, Buffer.from([${marker}]));
  },
});
`;
}

/**
 * A test-only actuator that mirrors an anonymous number argument to an I2C byte
 * at `address`, biased by {@link OBSERVER_BIAS} so a signed field survives as an
 * unsigned byte.
 */
function numberObserverSource(name: string, address: number): string {
  return `import { Actuator, type Context, NumberType, param } from "mindcraft";

export default Actuator({
  name: ${JSON.stringify(name)},
  args: [param("value", { type: NumberType, anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): void {
    ctx.microbit.i2c.writeBuffer(${address}, Buffer.from([args.value + ${OBSERVER_BIAS}]));
  },
});
`;
}

/** The one compiled project: the shipped gamepad tiles plus the test-only trigger and observers. */
function projectFiles(): Record<string, string> {
  return {
    "position.ts": readText("./gamepad/position.ts"),
    "protocol.ts": readText("./gamepad/protocol.ts"),
    "stick-read.ts": readText("./gamepad/stick-read.ts"),
    "stick.ts": readText("./gamepad/stick.ts"),
    "button.ts": readText("./gamepad/button.ts"),
    "stick-position.ts": readText("./gamepad/stick-position.ts"),
    "decoded-stick-position.ts": readText("./gamepad/decoded-stick-position.ts"),
    "position-to-buffer.ts": readText("./gamepad/position-to-buffer.ts"),
    "always.ts": ALWAYS_SOURCE,
    "mark-up.ts": observerSource("mark up", MARK.up),
    "mark-down.ts": observerSource("mark down", MARK.down),
    "mark-left.ts": observerSource("mark left", MARK.left),
    "mark-right.ts": observerSource("mark right", MARK.right),
    "mark-bare.ts": observerSource("mark bare", MARK.bare),
    "mark-up-left.ts": observerSource("mark up-left", MARK.upLeft),
    "mark-red.ts": observerSource("mark red", MARK.red),
    "mark-green.ts": observerSource("mark green", MARK.green),
    "mark-blue.ts": observerSource("mark blue", MARK.blue),
    "mark-yellow.ts": observerSource("mark yellow", MARK.yellow),
    "mark-any-button.ts": observerSource("mark any-button", MARK.anyButton),
    "mark-red-blue.ts": observerSource("mark red-blue", MARK.redBlue),
    "observe-x.ts": numberObserverSource("observe x", OBS_X_ADDRESS),
    "observe-y.ts": numberObserverSource("observe y", OBS_Y_ADDRESS),
  };
}

/** One scheduled think and the analog / digital pin levels injected before it runs. */
interface Step {
  readonly analog?: Readonly<Record<number, number>>;
  readonly digital?: Readonly<Record<number, number>>;
}

/** What a run observed: every observer I2C byte tagged with its address and tick. */
interface RunResult {
  readonly writes: readonly { readonly address: number; readonly byte: number; readonly tick: number }[];
  readonly program: LinkedBrainProgram;
}

const environment = { current: undefined as MindcraftEnvironment | undefined };
const tilesByName = new Map<string, IBrainTileDef>();
const bundleTiles = { current: [] as readonly IBrainTileDef[] };

before(() => {
  const env = createMicroBitV2Environment();
  const project = new UserTileProject({ ambientFiles: microbitAmbientFiles(), services: env.brainServices });
  project.setFiles(new Map(Object.entries(projectFiles())));
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: env.brainServices });
  assert.ok(bundle, "expected a compiled action bundle");
  env.replaceActionBundle(bundle);
  for (const tile of bundle.tiles) {
    if (tile.metadata?.label) {
      tilesByName.set(tile.metadata.label, tile);
    }
  }
  bundleTiles.current = bundle.tiles;
  environment.current = env;
});

/** Resolves a compiled user tile by its display name. */
function userTile(name: string): IBrainTileDef {
  const tile = tilesByName.get(name);
  assert.ok(tile, `user tile "${name}" not found; have: ${[...tilesByName.keys()].join(", ")}`);
  return tile;
}

/** A shared modifier tile by its id suffix, e.g. "direction.up" or "color.red". */
function sharedModifier(suffix: string): IBrainTileDef {
  return new BrainTileModifierDef(`modifier.${suffix}`);
}

/** The registered TypeId of the position struct. */
function positionTypeId(env: MindcraftEnvironment): TypeId {
  const typeId = env.brainServices.runtime.types.resolveByName(POSITION_IDENTITY);
  assert.ok(typeId, "expected the position struct type to be registered");
  return typeId;
}

/** The accessor tile reading field `field` off a position value. */
function accessorTile(env: MindcraftEnvironment, field: string): IBrainTileDef {
  const tileId = mkAccessorTileId(positionTypeId(env), field);
  const tile = bundleTiles.current.find((candidate) => candidate.tileId === tileId);
  assert.ok(tile, `expected the "${field}" accessor tile in the bundle`);
  return tile;
}

function run(env: MindcraftEnvironment, brainDef: BrainDef, schedule: readonly Step[]): RunResult {
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  assert.ok(built.ok, `expected a successful build: ${built.ok ? "" : JSON.stringify(built.errors)}`);

  const microbit = new MicroBit();
  let tick = 0;
  const writes: { address: number; byte: number; tick: number }[] = [];

  const rawWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    writes.push({ address, byte: data[0] ?? -1, tick });
    return rawWrite(address, data);
  };

  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  assert.deepEqual(runtime.loadWodalProgramImage(built.image), { ok: true }, "program should load");

  for (const [index, step] of schedule.entries()) {
    tick = index + 1;
    if (step.analog) {
      for (const [pin, level] of Object.entries(step.analog)) {
        microbit.gpio.setAnalogRead(Number(pin), level);
      }
    }
    if (step.digital) {
      for (const [pin, level] of Object.entries(step.digital)) {
        microbit.gpio.setDigitalRead(Number(pin), level);
      }
    }
    runtime.tick(16);
  }

  return { writes, program: built.image.program };
}

/** Observer marker bytes fired on `tick`, sorted for order-independent comparison. */
function marksAt(result: RunResult, tick: number): number[] {
  return result.writes
    .filter((entry) => entry.address === OBSERVER_ADDRESS && entry.tick === tick)
    .map((entry) => entry.byte)
    .sort((a, b) => a - b);
}

/** The signed value mirrored to `address` on `tick`, de-biased; asserts exactly one such write. */
function valueAt(result: RunResult, address: number, tick: number): number {
  const matches = result.writes.filter((entry) => entry.address === address && entry.tick === tick);
  assert.equal(matches.length, 1, `expected exactly one write to address ${address} on tick ${tick}`);
  return matches[0]!.byte - OBSERVER_BIAS;
}

/** A rule as `when [+ when-modifier] -> do`, naming compiled tiles by display name. */
interface RuleSpec {
  readonly when: string;
  readonly whenMods?: readonly string[];
  readonly do: string;
}

/** A one-page brain with one rule per spec; the first fills the empty page's rule. */
function brainWithRules(env: MindcraftEnvironment, name: string, rules: readonly RuleSpec[]): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(env.brainServices, name);
  const page = brainDef.pages().get(0)!;
  for (const [index, spec] of rules.entries()) {
    const rule = index === 0 ? page.children().get(0) : page.appendNewRule();
    assert.ok(rule, `expected a rule at index ${index}`);
    rule.when().appendTile(userTile(spec.when));
    for (const suffix of spec.whenMods ?? []) {
      rule.when().appendTile(sharedModifier(suffix));
    }
    rule.do().appendTile(userTile(spec.do));
  }
  return brainDef;
}

/** All pull-up lines idle-high (nothing pressed), the baseline for a stick-direction step. */
const IDLE_BUTTONS: Readonly<Record<number, number>> = {
  [PRESS_PIN]: HIGH,
  [RED_PIN]: HIGH,
  [GREEN_PIN]: HIGH,
  [BLUE_PIN]: HIGH,
  [YELLOW_PIN]: HIGH,
};

/** A stick step: both axes at raw levels, the press released, buttons idle. */
function stickStep(vertical: number, horizontal: number, extra?: Readonly<Record<number, number>>): Step {
  return {
    analog: { [VERTICAL_PIN]: vertical, [HORIZONTAL_PIN]: horizontal },
    digital: { ...IDLE_BUTTONS, ...extra },
  };
}

describe("Yahboom gamepad stick direction", () => {
  test("each vendor threshold band maps to its direction; the dead zone is no direction", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "gamepad direction bands", [
      { when: "stick", whenMods: ["direction.up"], do: "mark up" },
      { when: "stick", whenMods: ["direction.down"], do: "mark down" },
      { when: "stick", whenMods: ["direction.left"], do: "mark left" },
      { when: "stick", whenMods: ["direction.right"], do: "mark right" },
    ]);
    // Vertical is checked before horizontal, so a centered axis yields to the
    // other. Bands: raw < 200 low direction, raw > 730 high direction.
    const result = run(env, brainDef, [
      stickStep(100, HORIZONTAL_REST), // vertical low -> up
      stickStep(900, HORIZONTAL_REST), // vertical high -> down
      stickStep(VERTICAL_REST, 100), // horizontal low -> right
      stickStep(VERTICAL_REST, 900), // horizontal high -> left
      stickStep(VERTICAL_REST, HORIZONTAL_REST), // both centered -> none
    ]);
    assert.deepEqual(marksAt(result, 1), [MARK.up], "vertical raw 100 is up");
    assert.deepEqual(marksAt(result, 2), [MARK.down], "vertical raw 900 is down");
    assert.deepEqual(marksAt(result, 3), [MARK.right], "horizontal raw 100 is right");
    assert.deepEqual(marksAt(result, 4), [MARK.left], "horizontal raw 900 is left");
    assert.deepEqual(marksAt(result, 5), [], "both axes centered is no direction");
  });

  test("a press dominates: every direction reads false while the stick is pressed", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "gamepad press dominance", [
      { when: "stick", whenMods: ["direction.up"], do: "mark up" },
      { when: "stick", do: "mark bare" },
    ]);
    const result = run(env, brainDef, [
      stickStep(100, HORIZONTAL_REST), // up, not pressed
      stickStep(100, HORIZONTAL_REST, { [PRESS_PIN]: LOW }), // up deflection but pressed
    ]);
    assert.deepEqual(marksAt(result, 1), [MARK.up, MARK.bare], "up fires while not pressed");
    assert.deepEqual(marksAt(result, 2), [], "press suppresses the direction entirely");
  });

  test("direction modifiers OR-match and the bare tile fires on any direction", () => {
    const env = environment.current!;
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "gamepad direction or-match");
    const page = brainDef.pages().get(0)!;
    // [stick][up][left] fires on up or left, not on down/right.
    const orRule = page.children().get(0)!;
    orRule.when().appendTile(userTile("stick"));
    orRule.when().appendTile(sharedModifier("direction.up"));
    orRule.when().appendTile(sharedModifier("direction.left"));
    orRule.do().appendTile(userTile("mark up-left"));
    // Bare [stick] fires on any direction.
    const bareRule = page.appendNewRule()!;
    bareRule.when().appendTile(userTile("stick"));
    bareRule.do().appendTile(userTile("mark bare"));

    const result = run(env, brainDef, [
      stickStep(100, HORIZONTAL_REST), // up
      stickStep(VERTICAL_REST, 900), // left
      stickStep(900, HORIZONTAL_REST), // down
      stickStep(VERTICAL_REST, 100), // right
      stickStep(VERTICAL_REST, HORIZONTAL_REST), // none
    ]);
    assert.deepEqual(marksAt(result, 1), [MARK.bare, MARK.upLeft], "up: both the OR tile and bare fire");
    assert.deepEqual(marksAt(result, 2), [MARK.bare, MARK.upLeft], "left: both the OR tile and bare fire");
    assert.deepEqual(marksAt(result, 3), [MARK.bare], "down: only the bare tile fires");
    assert.deepEqual(marksAt(result, 4), [MARK.bare], "right: only the bare tile fires");
    assert.deepEqual(marksAt(result, 5), [], "centered: nothing fires");
  });
});

describe("Yahboom gamepad buttons", () => {
  /** A button step: stick centered and released, all buttons idle-high except those pressed. */
  function buttonStep(pressed: readonly number[]): Step {
    const digital: Record<number, number> = { ...IDLE_BUTTONS };
    for (const pin of pressed) {
      digital[pin] = LOW;
    }
    return { analog: { [VERTICAL_PIN]: VERTICAL_REST, [HORIZONTAL_PIN]: HORIZONTAL_REST }, digital };
  }

  test("each color maps to its pin, LOW-active, and colors OR-match; bare fires on any", () => {
    const env = environment.current!;
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "gamepad buttons");
    const page = brainDef.pages().get(0)!;
    const rules: { color?: string; mark: string }[] = [
      { color: "color.red", mark: "mark red" },
      { color: "color.green", mark: "mark green" },
      { color: "color.blue", mark: "mark blue" },
      { color: "color.yellow", mark: "mark yellow" },
      { mark: "mark any-button" },
    ];
    rules.forEach((spec, index) => {
      const rule = index === 0 ? page.children().get(0)! : page.appendNewRule()!;
      rule.when().appendTile(userTile("button"));
      if (spec.color) {
        rule.when().appendTile(sharedModifier(spec.color));
      }
      rule.do().appendTile(userTile(spec.mark));
    });
    // [button][red][blue] fires on red or blue only.
    const orRule = page.appendNewRule()!;
    orRule.when().appendTile(userTile("button"));
    orRule.when().appendTile(sharedModifier("color.red"));
    orRule.when().appendTile(sharedModifier("color.blue"));
    orRule.do().appendTile(userTile("mark red-blue"));

    const result = run(env, brainDef, [
      buttonStep([RED_PIN]),
      buttonStep([GREEN_PIN]),
      buttonStep([BLUE_PIN]),
      buttonStep([YELLOW_PIN]),
      buttonStep([]),
    ]);
    assert.deepEqual(
      marksAt(result, 1),
      [MARK.red, MARK.anyButton, MARK.redBlue].sort((a, b) => a - b),
      "B1 = red"
    );
    assert.deepEqual(
      marksAt(result, 2),
      [MARK.green, MARK.anyButton].sort((a, b) => a - b),
      "B2 = green"
    );
    assert.deepEqual(
      marksAt(result, 3),
      [MARK.blue, MARK.anyButton, MARK.redBlue].sort((a, b) => a - b),
      "B3 = blue"
    );
    assert.deepEqual(
      marksAt(result, 4),
      [MARK.yellow, MARK.anyButton].sort((a, b) => a - b),
      "B4 = yellow"
    );
    assert.deepEqual(marksAt(result, 5), [], "no button held: nothing fires");
  });
});

describe("Yahboom gamepad stick position", () => {
  /** A brain that mirrors [stick position][x] and [stick position][y] through the accessors. */
  function observeBrain(env: MindcraftEnvironment, name: string): BrainDef {
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, name);
    const page = brainDef.pages().get(0)!;
    const xRule = page.children().get(0)!;
    xRule.when().appendTile(userTile("always"));
    xRule.do().appendTile(userTile("observe x"));
    xRule.do().appendTile(userTile("stick position"));
    xRule.do().appendTile(accessorTile(env, "x"));
    const yRule = page.appendNewRule()!;
    yRule.when().appendTile(userTile("always"));
    yRule.do().appendTile(userTile("observe y"));
    yRule.do().appendTile(userTile("stick position"));
    yRule.do().appendTile(accessorTile(env, "y"));
    return brainDef;
  }

  test("exact centered, scaled, dead-banded, and clamped position fields via the accessor tiles", () => {
    const env = environment.current!;
    const cases: { name: string; vertical: number; horizontal: number; x: number; y: number }[] = [
      { name: "rest snaps to centered zero", vertical: VERTICAL_REST, horizontal: HORIZONTAL_REST, x: 0, y: 0 },
      { name: "full up-right saturates to +100", vertical: 0, horizontal: 0, x: 100, y: 100 },
      { name: "full down-left saturates to -100", vertical: 1018, horizontal: 1023, x: -100, y: -100 },
      { name: "per-side scaling reaches +50", vertical: 225, horizontal: 226, x: 50, y: 50 },
      { name: "dead zone reads zero", vertical: 528, horizontal: 472, x: 0, y: 0 },
      { name: "negative rescale reads -25", vertical: 667, horizontal: HORIZONTAL_REST, x: 0, y: -25 },
      { name: "beyond full deflection clamps to -100", vertical: 1023, horizontal: HORIZONTAL_REST, x: 0, y: -100 },
    ];
    for (const { name, vertical, horizontal, x, y } of cases) {
      const result = run(env, observeBrain(env, `gamepad position ${name}`), [
        { analog: { [VERTICAL_PIN]: vertical, [HORIZONTAL_PIN]: horizontal }, digital: IDLE_BUTTONS },
      ]);
      assert.equal(valueAt(result, OBS_X_ADDRESS, 1), x, `${name}: x = ${x}`);
      assert.equal(valueAt(result, OBS_Y_ADDRESS, 1), y, `${name}: y = ${y}`);
    }
  });
});

describe("Yahboom gamepad position struct type", () => {
  test("the struct type is registered and a tile declares it as a returnType", () => {
    const env = environment.current!;
    // The go/no-go probe: the type resolves by its symbol identity, and the
    // stick-position sensor built against `returnType: Position`.
    assert.ok(env.brainServices.runtime.types.resolveByName(POSITION_IDENTITY), "position type is registered");
    assert.ok(userTile("stick position"), "the stick-position tile referencing Position compiled");
    assert.ok(userTile("decoded stick position"), "the decoder tile referencing Position compiled");
  });

  /** Manufactures and registers a fresh position variable tile named `name`. */
  function positionVariable(env: MindcraftEnvironment, brainDef: BrainDef, name: string): IBrainTileDef {
    const factory = bundleTiles.current.find((tile) => tile.tileId === mkVariableFactoryTileId(positionTypeId(env))) as
      | BrainTileFactoryDef
      | undefined;
    assert.ok(factory, "expected the position variable factory in the bundle");
    const variable = factory.manufacture(factory, { name });
    assert.ok(variable, "the factory manufactured a position variable tile");
    brainDef.catalog().registerTileDef(variable);
    return variable;
  }

  test("the accessor tiles are derived and offered in the picker after a position value", () => {
    const env = environment.current!;
    const typeId = positionTypeId(env);
    // Both field accessors exist in the bundle.
    for (const field of ["x", "y"]) {
      assert.ok(
        bundleTiles.current.some((tile) => tile.tileId === mkAccessorTileId(typeId, field)),
        `the ${field} accessor tile is derived`
      );
    }
    // The picker offers them after a position-typed variable.
    const scratch = BrainDef.emptyBrainDef(env.brainServices, "gamepad accessor picker");
    const posVar = positionVariable(env, scratch, "dot");
    const expr = parseTilesForSuggestions(List.from([posVar]));
    const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
    const result = suggestTiles(ctx, List.from([...env.tileCatalogs(), scratch.catalog()]), env.brainServices);
    const offered = new Set<string>();
    for (let i = 0; i < result.exact.size(); i++) offered.add(result.exact.get(i).tileDef.tileId);
    for (const field of ["x", "y"]) {
      assert.ok(offered.has(mkAccessorTileId(typeId, field)), `the picker offers the ${field} accessor`);
    }
  });

  test("the variable factory creates a position variable that stores and reads back through accessors", () => {
    const env = environment.current!;
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "gamepad position variable");
    const posVar = positionVariable(env, brainDef, "dot");
    const page = brainDef.pages().get(0)!;
    // r1: dot := stick position (snapshot the whole struct into a variable).
    const assignRule = page.children().get(0)!;
    assignRule.when().appendTile(userTile("always"));
    assignRule.do().appendTile(posVar);
    assignRule.do().appendTile(new BrainTileOperatorDef("assign", {}, env.brainServices));
    assignRule.do().appendTile(userTile("stick position"));
    // r2/r3: read [dot][x] / [dot][y] back through the accessors.
    const xRule = page.appendNewRule()!;
    xRule.when().appendTile(userTile("always"));
    xRule.do().appendTile(userTile("observe x"));
    xRule.do().appendTile(posVar);
    xRule.do().appendTile(accessorTile(env, "x"));
    const yRule = page.appendNewRule()!;
    yRule.when().appendTile(userTile("always"));
    yRule.do().appendTile(userTile("observe y"));
    yRule.do().appendTile(posVar);
    yRule.do().appendTile(accessorTile(env, "y"));

    // Stick at +50 / -25; the stored snapshot reads back the same on the second think.
    const result = run(env, brainDef, [
      { analog: { [VERTICAL_PIN]: 667, [HORIZONTAL_PIN]: 226 }, digital: IDLE_BUTTONS },
      { analog: { [VERTICAL_PIN]: 667, [HORIZONTAL_PIN]: 226 }, digital: IDLE_BUTTONS },
    ]);
    assert.equal(valueAt(result, OBS_X_ADDRESS, 2), 50, "stored position reads back x = 50");
    assert.equal(valueAt(result, OBS_Y_ADDRESS, 2), -25, "stored position reads back y = -25");
  });
});
