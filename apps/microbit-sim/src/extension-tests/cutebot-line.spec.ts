/**
 * Headless compile-and-run validation for the Cutebot line-sensor driver. It
 * compiles the shipped `cutebot/line-sensor.ts` System and the modifier-based
 * `cutebot/line-left.ts` sensor (plus a right-side probe and observer actuators)
 * into real brains, runs them on the WODAL microbit-v2 runtime, and taps the
 * device to observe what the System actually did: pull configuration and pin
 * reads on the GPIO port, and rule firings via observer actuators that write a
 * distinct byte to a test I2C address.
 *
 * It exercises the System at real multiplicity: init once / think every tick,
 * edge detection across ticks with the one-think pipeline, left/right
 * independence, one shared instance across two callsites, per-brain reachability
 * across two brains, and page-independent ticking with state that survives a
 * page switch. It also checks the line sensor's found/lost/on modifier selects
 * the reported accessor, with "on" as the no-modifier default.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@mindcraft-lang/core";
import { BrainDef, BrainTileModifierDef, type MindcraftEnvironment, mkActuatorTileId } from "@mindcraft-lang/core/app";
import { type IBrainPageDef, type IBrainTileDef, mkPageTileId, RuleSide } from "@mindcraft-lang/core/brain";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@mindcraft-lang/core/brain/language-service";
import { CoreHostActions, type LinkedBrainProgram, mkModifierTileId } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { MicroBit, WodalMicroBitRuntime } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { buildExtensionTestHarness, CUTEBOT_EXT_COORDINATE, type ExtensionTestHarness } from "./extension-test-harness";

/** GPIO pins the Cutebot line sensors are wired to; a line reads LOW. */
const LEFT_PIN = 13;
const RIGHT_PIN = 14;

/** Pin level a line sensor reports off the line (HIGH) and on the line (LOW). */
const OFF_LINE = 1;
const ON_LINE = 0;

/** Display names of the shipped left and right line sensors. */
const LEFT_TILE = "cutebot line (left)";
const RIGHT_TILE = "cutebot line (right)";

/** 7-bit I2C address the test-only observer actuators write to; each writes one distinct marker byte. */
const OBSERVER_ADDRESS = 0x50;

/** Marker bytes an observer actuator writes so a firing can be attributed to its rule. */
const MARK = {
  found: 0x0a,
  lost: 0x0b,
  right: 0x0c,
  second: 0x0d,
  online: 0x0e,
  plain: 0x0f,
} as const;

/** Source of a test-only actuator that marks a rule firing by writing one byte to the observer address. */
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

/** An always-true trigger, so a rule driving it fires every think its page is active. */
const ALWAYS_SOURCE = `import { type Context, Sensor } from "mindcraft";

export default Sensor({
  name: "always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

/**
 * The test-only trigger and observer tiles compiled in the host workspace
 * alongside the installed Cutebot add-on, whose shipped line tiles and shared
 * line System come from the extension namespace.
 */
function workspaceTiles(): Record<string, string> {
  return {
    "always.ts": ALWAYS_SOURCE,
    "mark-found.ts": observerSource("mark found", MARK.found),
    "mark-lost.ts": observerSource("mark lost", MARK.lost),
    "mark-right.ts": observerSource("mark right", MARK.right),
    "mark-second.ts": observerSource("mark second", MARK.second),
    "mark-online.ts": observerSource("mark online", MARK.online),
    "mark-plain.ts": observerSource("mark plain", MARK.plain),
  };
}

/** One scheduled think and the pin levels injected before it runs. */
interface Step {
  readonly pins?: Readonly<Record<number, number>>;
}

/** A rule as `when [+ modifier] -> do`, naming compiled tiles by their display names. */
interface RuleSpec {
  readonly when: string;
  readonly mod?: string;
  readonly do: string;
}

/** What a run observed: GPIO taps tagged with the stage that ran them (init, or a tick number), and observer firings by tick. */
interface RunResult {
  /** Pull-mode configurations recorded, tagged with the stage that ran them (init as 0). */
  readonly setPulls: readonly { readonly pin: number; readonly mode: number; readonly stage: number }[];
  /** Digital pin reads recorded, tagged with the stage that ran them (init as 0). */
  readonly reads: readonly { readonly pin: number; readonly stage: number }[];
  /** Observer marker bytes written, tagged with the tick they happened on. */
  readonly fires: readonly { readonly marker: number; readonly tick: number }[];
  /** The tree-shaken linked program the brain built to, for reachability assertions. */
  readonly program: LinkedBrainProgram;
}

const environment = { current: undefined as MindcraftEnvironment | undefined };
const harnessRef = { current: undefined as ExtensionTestHarness | undefined };

before(() => {
  const harness = buildExtensionTestHarness({
    install: [CUTEBOT_EXT_COORDINATE],
    workspaceTiles: workspaceTiles(),
  });
  harnessRef.current = harness;
  environment.current = harness.env;
});

/** Resolves a compiled user tile by its display name. */
function userTile(name: string): IBrainTileDef {
  return harnessRef.current!.userTile(name);
}

/** The shared-namespace `found` / `lost` / `on` modifier tile for the line sensors. */
function lineModifier(modId: string): IBrainTileDef {
  return new BrainTileModifierDef(`modifier.cutebot-line.${modId}`);
}

/** Resolves a registered core host tile (e.g. switch page) from the environment. */
function coreTile(env: MindcraftEnvironment, tileId: string): IBrainTileDef {
  const tile = env.brainServices.edit.tiles.get(tileId);
  assert.ok(tile, `core tile ${tileId} should be registered`);
  return tile;
}

/** The catalog tile that names `page` as the switch-page argument. */
function pageArgTile(brainDef: BrainDef, page: IBrainPageDef): IBrainTileDef {
  const tile = brainDef.catalog().get(mkPageTileId(page.pageId()));
  assert.ok(tile, "page tile should be synced into the catalog");
  return tile;
}

/**
 * Builds `brainDef` into a microbit-v2 image, then runs it on a fresh device
 * over `schedule` with GPIO and observer-I2C taps installed before load, so the
 * System's startup `init` (which runs during load) is recorded under the init
 * stage.
 */
function run(env: MindcraftEnvironment, brainDef: BrainDef, schedule: readonly Step[]): RunResult {
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  assert.ok(built.ok, `expected a successful build: ${built.ok ? "" : JSON.stringify(built.errors)}`);
  const image = built.image;

  const microbit = new MicroBit();
  let stage = 0;
  const setPulls: { pin: number; mode: number; stage: number }[] = [];
  const reads: { pin: number; stage: number }[] = [];
  const fires: { marker: number; tick: number }[] = [];

  const rawSetPull = microbit.gpio.setPull.bind(microbit.gpio);
  microbit.gpio.setPull = (pin, mode) => {
    setPulls.push({ pin, mode, stage });
    return rawSetPull(pin, mode);
  };
  const rawRead = microbit.gpio.digitalRead.bind(microbit.gpio);
  microbit.gpio.digitalRead = (pin) => {
    reads.push({ pin, stage });
    return rawRead(pin);
  };
  const rawWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    if (address === OBSERVER_ADDRESS) {
      fires.push({ marker: data[0] ?? -1, tick: stage });
    }
    return rawWrite(address, data);
  };

  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  assert.deepEqual(runtime.loadWodalProgramImage(image), { ok: true }, "program should load");

  for (const [index, step] of schedule.entries()) {
    stage = index + 1;
    if (step.pins) {
      for (const [pin, level] of Object.entries(step.pins)) {
        microbit.gpio.setDigitalRead(Number(pin), level);
      }
    }
    runtime.tick(16);
  }

  return { setPulls, reads, fires, program: image.program };
}

/** Pins read during a stage (init as 0), in read order. */
function pinsReadAt(result: RunResult, stage: number): number[] {
  return result.reads.filter((entry) => entry.stage === stage).map((entry) => entry.pin);
}

/** Observer markers fired on `tick`, sorted for order-independent comparison. */
function marksAt(result: RunResult, tick: number): number[] {
  return result.fires
    .filter((entry) => entry.tick === tick)
    .map((entry) => entry.marker)
    .sort((a, b) => a - b);
}

/** Count of Systems registered in the tree-shaken program. */
function systemCount(result: RunResult): number {
  return result.program.program.systems?.size() ?? 0;
}

/** A one-page brain whose first rule is `when [+ modifier] -> do`; extra rules append at page level. */
function brainWithRules(env: MindcraftEnvironment, name: string, rules: readonly RuleSpec[]): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(env.brainServices, name);
  const page = brainDef.pages().get(0)!;
  for (const [index, spec] of rules.entries()) {
    const rule = index === 0 ? page.children().get(0) : page.appendNewRule();
    assert.ok(rule, `expected a rule at index ${index}`);
    rule.when().appendTile(userTile(spec.when));
    if (spec.mod) {
      rule.when().appendTile(lineModifier(spec.mod));
    }
    rule.do().appendTile(userTile(spec.do));
  }
  return brainDef;
}

describe("Cutebot line System", () => {
  test("init runs once at startup; think samples both pins every tick", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "cutebot line init/think", [
      { when: LEFT_TILE, mod: "found", do: "mark found" },
      { when: LEFT_TILE, mod: "on", do: "mark online" },
    ]);
    // No injection: both pins stay LOW (on the line), so no edges occur.
    const result = run(env, brainDef, [{}, {}, {}]);

    // init configured pull-none once on each sensor pin, both at startup.
    assert.deepEqual(
      result.setPulls,
      [
        { pin: LEFT_PIN, mode: 0, stage: 0 },
        { pin: RIGHT_PIN, mode: 0, stage: 0 },
      ],
      "init sets pull-none on pins 13 and 14 exactly once, at startup"
    );

    // init seeds from one read of each pin; every think re-reads both pins.
    assert.deepEqual(pinsReadAt(result, 0), [LEFT_PIN, RIGHT_PIN], "init seeds from one read per pin");
    for (const tick of [1, 2, 3]) {
      assert.deepEqual(pinsReadAt(result, tick), [LEFT_PIN, RIGHT_PIN], `think ${tick} samples both pins`);
    }

    // The "on" modifier fires every tick (left is on the line); the "found"
    // modifier never fires without a transition.
    for (const tick of [1, 2, 3]) {
      assert.deepEqual(marksAt(result, tick), [MARK.online], `on fires on tick ${tick}`);
    }
  });

  test("edge detection across ticks: found and lost fire one think after the crossing", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "cutebot line edges", [
      { when: LEFT_TILE, mod: "found", do: "mark found" },
      { when: LEFT_TILE, mod: "lost", do: "mark lost" },
    ]);
    // Seed is on-line (pin LOW at startup). Drive: on -> off (lost) -> on (found).
    const result = run(env, brainDef, [
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
    ]);

    // think samples the injected level at the end of each tick; a rule reads the
    // edge the previous think latched. So the off crossing (think 2) is seen at
    // tick 3, and the on crossing (think 3) at tick 4.
    assert.deepEqual(marksAt(result, 1), [], "no edge on tick 1");
    assert.deepEqual(marksAt(result, 2), [], "no edge on tick 2");
    assert.deepEqual(marksAt(result, 3), [MARK.lost], "lost edge observed one think after the off crossing");
    assert.deepEqual(marksAt(result, 4), [MARK.found], "found edge observed one think after the on crossing");
  });

  test("left and right sides track independently, no cross-talk", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "cutebot line independence", [
      { when: LEFT_TILE, mod: "found", do: "mark found" },
      { when: RIGHT_TILE, mod: "found", do: "mark right" },
    ]);
    // Push both off, then bring left on (think 2) and right on one think later
    // (think 3), so each side's found edge lands on a different tick.
    const result = run(env, brainDef, [
      { pins: { [LEFT_PIN]: OFF_LINE, [RIGHT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE, [RIGHT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: OFF_LINE, [RIGHT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: OFF_LINE, [RIGHT_PIN]: ON_LINE } },
    ]);

    assert.deepEqual(marksAt(result, 3), [MARK.found], "only the left found edge fires on tick 3");
    assert.deepEqual(marksAt(result, 4), [MARK.right], "only the right found edge fires on tick 4");
    assert.deepEqual(marksAt(result, 1), [], "no edge on tick 1");
    assert.deepEqual(marksAt(result, 2), [], "no edge on tick 2");
  });

  test("two callsites share one System instance", () => {
    const env = environment.current!;
    // Two independent rules read the same left-found edge: two callsites.
    const brainDef = brainWithRules(env, "cutebot line sharing", [
      { when: LEFT_TILE, mod: "found", do: "mark found" },
      { when: LEFT_TILE, mod: "found", do: "mark second" },
    ]);
    const result = run(env, brainDef, [
      { pins: { [LEFT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
    ]);

    // Both callsites observe the same found edge on the same tick.
    assert.deepEqual(marksAt(result, 3), [MARK.found, MARK.second], "both callsites fire on the one shared edge");

    // One shared instance, not one per callsite: exactly one registration, one
    // init (two pull configs, not four), and one think per tick (two pin reads,
    // not four).
    assert.equal(systemCount(result), 1, "two callsites register exactly one System");
    assert.equal(result.setPulls.length, 2, "init runs once for the shared System");
    for (const tick of [1, 2, 3]) {
      assert.deepEqual(pinsReadAt(result, tick), [LEFT_PIN, RIGHT_PIN], `think runs once on tick ${tick}`);
    }
  });

  test("a System is included per brain that reaches it, and only there", () => {
    const env = environment.current!;

    const usingBrain = brainWithRules(env, "cutebot line reachable", [
      { when: LEFT_TILE, mod: "found", do: "mark found" },
    ]);
    const using = run(env, usingBrain, [
      { pins: { [LEFT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
    ]);
    assert.equal(systemCount(using), 1, "a brain that uses a line tile includes the System");
    assert.equal(using.setPulls.length, 2, "the included System's init ran");
    assert.deepEqual(pinsReadAt(using, 1), [LEFT_PIN, RIGHT_PIN], "the included System's think ticks");
    assert.deepEqual(marksAt(using, 3), [MARK.found], "the reachable line tile fires");

    // A second brain in the same project touches no line code.
    const plainBrain = brainWithRules(env, "cutebot line unreachable", [{ when: "always", do: "mark plain" }]);
    const plain = run(env, plainBrain, [{}, {}, {}]);
    assert.equal(systemCount(plain), 0, "a brain that reaches no line code does not include the System");
    assert.equal(plain.setPulls.length, 0, "the unreached System's init never runs");
    assert.equal(plain.reads.length, 0, "the unreached System's think never samples the pins");
    for (const tick of [1, 2, 3]) {
      assert.deepEqual(marksAt(plain, tick), [MARK.plain], `the plain brain still runs on tick ${tick}`);
    }
  });

  test("think ticks page-independently and state survives a page switch", () => {
    const env = environment.current!;
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "cutebot line page-independence");
    const page0 = brainDef.pages().get(0)!;
    const appended = brainDef.appendNewPage();
    assert.ok(appended.success);
    const page1 = appended.value.page;

    // Page 0 switches to page 1 on the first tick. The line rules live only on
    // page 1, so their firing proves page 1 became active.
    const switchRule = page0.children().get(0)!;
    switchRule.when().appendTile(userTile("always"));
    switchRule.do().appendTile(coreTile(env, mkActuatorTileId(CoreHostActions.SwitchPage.key)));
    switchRule.do().appendTile(pageArgTile(brainDef, page1));

    const foundRule = page1.children().get(0)!;
    foundRule.when().appendTile(userTile(LEFT_TILE));
    foundRule.when().appendTile(lineModifier("found"));
    foundRule.do().appendTile(userTile("mark found"));
    const lostRule = page1.appendNewRule();
    assert.ok(lostRule);
    lostRule.when().appendTile(userTile(LEFT_TILE));
    lostRule.when().appendTile(lineModifier("lost"));
    lostRule.do().appendTile(userTile("mark lost"));

    // Seed is on-line (init on page 0). Keep on for tick 1 (switch tick), then
    // off (lost) and on (found) once page 1 is active.
    const result = run(env, brainDef, [
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
    ]);

    // init ran exactly once, never re-run by the page switch.
    assert.deepEqual(
      result.setPulls,
      [
        { pin: LEFT_PIN, mode: 0, stage: 0 },
        { pin: RIGHT_PIN, mode: 0, stage: 0 },
      ],
      "init runs once at startup and the page switch does not re-init the System"
    );

    // think keeps sampling both pins every tick, on page 0 (tick 1) and page 1.
    for (const tick of [1, 2, 3, 4]) {
      assert.deepEqual(pinsReadAt(result, tick), [LEFT_PIN, RIGHT_PIN], `think samples on tick ${tick}`);
    }

    // The lost edge on tick 3 was latched by think 2, off the on-line level the
    // seed set at init on page 0 -- so state persisted across the switch. The
    // found edge on tick 4 shows the System still detecting on page 1.
    assert.deepEqual(marksAt(result, 3), [MARK.lost], "lost edge across the page switch uses the persisted level");
    assert.deepEqual(marksAt(result, 4), [MARK.found], "found edge detected on page 1 after the switch");
  });

  test("the brain-editor picker offers the left sensor's found/lost/on modifiers", () => {
    const env = environment.current!;
    const expr = parseTilesForSuggestions(List.from([userTile(LEFT_TILE)]));
    const ctx: InsertionContext = { ruleSide: RuleSide.When, expr };
    const result = suggestTiles(ctx, List.from([...env.tileCatalogs()]), env.brainServices);

    const offered = new Set<string>();
    for (let i = 0; i < result.exact.size(); i++) offered.add(result.exact.get(i).tileDef.tileId);

    for (const modifier of ["found", "lost", "on"]) {
      assert.ok(
        offered.has(mkModifierTileId(`modifier.cutebot-line.${modifier}`)),
        `picker offers the "${modifier}" modifier`
      );
    }
  });

  test("the brain-editor picker offers the right sensor's found/lost/on modifiers", () => {
    const env = environment.current!;
    const expr = parseTilesForSuggestions(List.from([userTile(RIGHT_TILE)]));
    const ctx: InsertionContext = { ruleSide: RuleSide.When, expr };
    const result = suggestTiles(ctx, List.from([...env.tileCatalogs()]), env.brainServices);

    const offered = new Set<string>();
    for (let i = 0; i < result.exact.size(); i++) offered.add(result.exact.get(i).tileDef.tileId);

    // The right sensor shares the modifier.cutebot-line namespace with the left, so
    // the picker offers the same three modifier ids for both.
    for (const modifier of ["found", "lost", "on"]) {
      assert.ok(
        offered.has(mkModifierTileId(`modifier.cutebot-line.${modifier}`)),
        `picker offers the "${modifier}" modifier`
      );
    }
  });

  test("the found/lost/on modifier selects the reported accessor; bare tile reports on", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "cutebot line modifiers", [
      { when: LEFT_TILE, mod: "found", do: "mark found" },
      { when: LEFT_TILE, mod: "lost", do: "mark lost" },
      { when: LEFT_TILE, mod: "on", do: "mark online" },
      { when: LEFT_TILE, do: "mark plain" },
    ]);
    // Seed on-line. Hold on, go off (lost), come back on (found).
    const result = run(env, brainDef, [
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: OFF_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
      { pins: { [LEFT_PIN]: ON_LINE } },
    ]);

    // "on" and the bare (no-modifier) tile fire together on every on-line tick --
    // the bare tile reports "on".
    assert.deepEqual(marksAt(result, 1), [MARK.online, MARK.plain], "on-line: on and bare tile fire");
    assert.deepEqual(marksAt(result, 2), [MARK.online, MARK.plain], "still on-line: on and bare tile fire");
    // The off crossing (think 2) surfaces "lost" at tick 3, while "on"/bare go quiet.
    assert.deepEqual(marksAt(result, 3), [MARK.lost], "lost modifier fires on the off crossing");
    // The on crossing (think 3) surfaces "found" at tick 4, alongside "on"/bare.
    assert.deepEqual(marksAt(result, 4), [MARK.found, MARK.online, MARK.plain], "found fires with on and bare tile");
  });

  test("the right sensor's modifiers dispatch to the right-side accessors", () => {
    const env = environment.current!;
    const brainDef = brainWithRules(env, "cutebot line right modifiers", [
      { when: RIGHT_TILE, mod: "found", do: "mark found" },
      { when: RIGHT_TILE, mod: "lost", do: "mark lost" },
      { when: RIGHT_TILE, mod: "on", do: "mark online" },
      { when: RIGHT_TILE, do: "mark plain" },
    ]);
    // Same sequence as the left case, driven on the right pin (14).
    const result = run(env, brainDef, [
      { pins: { [RIGHT_PIN]: ON_LINE } },
      { pins: { [RIGHT_PIN]: OFF_LINE } },
      { pins: { [RIGHT_PIN]: ON_LINE } },
      { pins: { [RIGHT_PIN]: ON_LINE } },
    ]);

    // The right sensor reports right() (on/bare) and the right edges (found/lost),
    // confirming it wires to the right-side accessors.
    assert.deepEqual(marksAt(result, 1), [MARK.online, MARK.plain], "on-line: on and bare tile fire");
    assert.deepEqual(marksAt(result, 2), [MARK.online, MARK.plain], "still on-line: on and bare tile fire");
    assert.deepEqual(marksAt(result, 3), [MARK.lost], "lost modifier fires on the off crossing");
    assert.deepEqual(marksAt(result, 4), [MARK.found, MARK.online, MARK.plain], "found fires with on and bare tile");
  });
});
