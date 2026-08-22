/**
 * Headless compile-and-run validation for the Cutebot movement arbitrator. It
 * compiles the shipped `cutebot/movement.ts` System and the four movement
 * tiles into real brains, runs them on the WODAL microbit-v2 runtime, and
 * decodes every motor command the arbitrator wrote to the chassis address, so
 * each pipeline stage is pinned by exact wheel values: the per-wheel blend
 * sum, the rate-word ladder, direction words, stop dominance, the silence
 * hold window (steady output through command gaps, exact expiry, the stop
 * clearing the held target, restart on fresh emissions), scale-preserving
 * saturation, the drift gain trim, the smoothing curve with its near-snap
 * and stop deadband, and the shared-System multiplicity across callsites
 * and brains.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { List } from "@wendoo-lang/core";
import { BrainDef, BrainTileModifierDef, mkActuatorTileId, type WendooEnvironment } from "@wendoo-lang/core/app";
import { type IBrainPageDef, type IBrainTileDef, mkPageTileId, RuleSide } from "@wendoo-lang/core/brain";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@wendoo-lang/core/brain/language-service";
import { CoreHostActions, type LinkedBrainProgram, mkModifierTileId } from "@wendoo-lang/core/runtime";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@wendoo-lang/wodal";
import { MicroBit, WodalMicroBitRuntime } from "@wendoo-lang/wodal/targets/microbit-v2";
import {
  buildExtensionTestHarness,
  CUTEBOT_EXT_COORDINATE,
  type ExtensionFileOverlay,
  type ExtensionTestHarness,
} from "./extension-test-harness";

/** Cutebot STM8 motor-driver I2C address the arbitrator writes wheel commands to. */
const CHASSIS_ADDRESS = 0x10;

/** 7-bit I2C address the test-only observer actuators write marker bytes to. */
const OBSERVER_ADDRESS = 0x50;

/** GPIO pins the test rules use as controllable triggers; a rule fires while its pin reads 1. */
const GATE_PIN = 5;
const GATE2_PIN = 6;

/** Marker bytes an observer actuator writes so a firing can be attributed to its rule. */
const MARK = {
  plain: 0x0a,
  driftClamped: 0x0b,
  smoothingSet: 0x0c,
} as const;

/** An always-true trigger, so a rule driving it fires every think its page is active. */
const ALWAYS_SOURCE = `import { type Context, Sensor } from "wendoo";

export default Sensor({
  name: "always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

/** Source of a trigger that fires while `pin` reads high, so a test can turn a rule on and off per tick. */
function gateSource(name: string, pin: number): string {
  return `import { type Context, Sensor } from "wendoo";

export default Sensor({
  name: ${JSON.stringify(name)},
  onExecute(ctx: Context): boolean {
    return ctx.microbit.gpio.digitalRead(${pin}) === 1;
  },
});
`;
}

/** Source of a test-only actuator that sets the Movement drift trim to `value`. */
function setDriftSource(id: string, name: string, value: number): string {
  return `import { Actuator, type Context } from "wendoo";
import { Movement } from "./movement";

export default Actuator({
  name: ${JSON.stringify(name)},
  id: ${JSON.stringify(id)},
  onExecute(ctx: Context): void {
    Movement.setDrift(${value});
  },
});
`;
}

/** Source of a test-only actuator that sets the Movement smoothing factor to `value`. */
function setSmoothingSource(id: string, name: string, value: number): string {
  return `import { Actuator, type Context } from "wendoo";
import { Movement } from "./movement";

export default Actuator({
  name: ${JSON.stringify(name)},
  id: ${JSON.stringify(id)},
  onExecute(ctx: Context): void {
    Movement.setSmoothing(${value});
  },
});
`;
}

/** Source of a test-only sensor that reports whether a Movement getter returns `expected`. */
function getterProbeSource(id: string, name: string, getter: "getDrift" | "getSmoothing", expected: number): string {
  return `import { type Context, Sensor } from "wendoo";
import { Movement } from "./movement";

export default Sensor({
  name: ${JSON.stringify(name)},
  id: ${JSON.stringify(id)},
  onExecute(ctx: Context): boolean {
    return Movement.${getter}() === ${expected};
  },
});
`;
}

/** Source of a test-only actuator that marks a rule firing by writing one byte to the observer address. */
function observerSource(name: string, marker: number): string {
  return `import { Actuator, type Context } from "wendoo";

export default Actuator({
  name: ${JSON.stringify(name)},
  onExecute(ctx: Context): void {
    ctx.microbit.i2c.writeBuffer(${OBSERVER_ADDRESS}, Buffer.from([${marker}]));
  },
});
`;
}

/**
 * The test-only trigger, gate, and observer tiles compiled in the host
 * workspace alongside the installed Cutebot add-on; the shipped movement System
 * and its tiles come from the extension namespace.
 */
function workspaceTiles(): Record<string, string> {
  return {
    "always.ts": ALWAYS_SOURCE,
    "gate.ts": gateSource("gate high", GATE_PIN),
    "gate2.ts": gateSource("gate2 high", GATE2_PIN),
    "mark-plain.ts": observerSource("mark plain", MARK.plain),
    "mark-drift.ts": observerSource("mark drift", MARK.driftClamped),
    "mark-smoothing.ts": observerSource("mark smoothing", MARK.smoothingSet),
  };
}

/**
 * The test-only arbitrator config setters and getter probes compiled into the
 * Cutebot add-on's own namespace, so each reaches the shared movement System
 * through its relative `./movement` import and shares the one arbitrator with
 * the shipped drive/turn/pivot/stop tiles. Read-only extension source, so each
 * carries an explicit stable id.
 */
function arbitratorProbeTiles(): readonly ExtensionFileOverlay[] {
  const overlay = (path: string, content: string): ExtensionFileOverlay => ({
    coordinate: CUTEBOT_EXT_COORDINATE,
    path,
    content,
  });
  return [
    overlay("set-drift.ts", setDriftSource("ybelzjhoann7lxww", "calibrate drift", 12)),
    overlay("set-drift-over.ts", setDriftSource("PEiUoOBqL0gGwlw0", "calibrate drift over", 40)),
    overlay("set-smoothing.ts", setSmoothingSource("OZUPslILwVXGTWbZ", "smooth half", 0.5)),
    overlay("set-smoothing-heavy.ts", setSmoothingSource("3HbYuyGkyxILr4CO", "smooth heavy", 0.9)),
    overlay("drift-probe.ts", getterProbeSource("hpr6dOOnskWLaBTq", "drift clamped", "getDrift", 25)),
    overlay("smoothing-probe.ts", getterProbeSource("QjjPZp3VAIyKAL7m", "smoothing set", "getSmoothing", 0.5)),
  ];
}

/** One scheduled think and the gate-pin levels injected before it runs. */
interface Step {
  readonly gate?: 0 | 1;
  readonly gate2?: 0 | 1;
}

/** A rule as `when [+ modifier] -> do [+ modifiers]`, naming compiled tiles by their display names. */
interface RuleSpec {
  readonly when: string;
  readonly do: string;
  /** Modifier id suffixes appended to the DO tile, e.g. "speed.slowly" or "direction.left". */
  readonly doMods?: readonly string[];
}

/** What a run observed: decoded wheel writes and observer markers, tagged by tick, plus the linked program. */
interface RunResult {
  /** Signed wheel percents decoded from each tick's chassis writes, keyed by tick. */
  readonly wheels: ReadonlyMap<number, number[][]>;
  /** Observer marker bytes written, tagged with the tick they happened on. */
  readonly fires: readonly { readonly marker: number; readonly tick: number }[];
  /** The tree-shaken linked program the brain built to, for reachability assertions. */
  readonly program: LinkedBrainProgram;
}

const environment = { current: undefined as WendooEnvironment | undefined };
const harnessRef = { current: undefined as ExtensionTestHarness | undefined };

before(() => {
  const harness = buildExtensionTestHarness({
    install: [CUTEBOT_EXT_COORDINATE],
    workspaceTiles: workspaceTiles(),
    extensionTiles: arbitratorProbeTiles(),
  });
  harnessRef.current = harness;
  environment.current = harness.env;
});

/** Resolves a compiled user tile by its display name. */
function userTile(name: string): IBrainTileDef {
  return harnessRef.current!.userTile(name);
}

/** A shared modifier tile by its id suffix, e.g. "speed.slowly" or "direction.left". */
function sharedModifier(suffix: string): IBrainTileDef {
  return new BrainTileModifierDef(`modifier.${suffix}`);
}

/** Resolves a registered core host tile (e.g. switch page) from the environment. */
function coreTile(env: WendooEnvironment, tileId: string): IBrainTileDef {
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

/** A one-page brain with one rule per `RuleSpec`, in order. */
function brainWithRules(env: WendooEnvironment, name: string, rules: readonly RuleSpec[]): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(env.brainServices, name);
  const page = brainDef.pages().get(0)!;
  for (const [index, spec] of rules.entries()) {
    const rule = index === 0 ? page.children().get(0) : page.appendNewRule();
    assert.ok(rule, `expected a rule at index ${index}`);
    rule.when().appendTile(userTile(spec.when));
    rule.do().appendTile(userTile(spec.do));
    for (const suffix of spec.doMods ?? []) {
      rule.do().appendTile(sharedModifier(suffix));
    }
  }
  return brainDef;
}

/**
 * Builds `brainDef` into a microbit-v2 image, runs it on a fresh device over
 * `schedule`, and decodes every chassis write into signed wheel percents. A
 * 4-byte command `[wheel, direction, speed, 0]` decodes to `+speed` for the
 * forward direction byte (0x02) and `-speed` for backward (0x01).
 */
function run(env: WendooEnvironment, brainDef: BrainDef, schedule: readonly Step[]): RunResult {
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  assert.ok(built.ok, `expected a successful build: ${built.ok ? "" : JSON.stringify(built.errors)}`);

  const microbit = new MicroBit();
  let tick = 0;
  const raw = new Map<number, number[][]>();
  const fires: { marker: number; tick: number }[] = [];
  const rawWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    if (address === CHASSIS_ADDRESS) {
      let commands = raw.get(tick);
      if (!commands) {
        commands = [];
        raw.set(tick, commands);
      }
      commands.push([...data]);
    }
    if (address === OBSERVER_ADDRESS) {
      fires.push({ marker: data[0] ?? -1, tick });
    }
    return rawWrite(address, data);
  };

  const runtime = new WodalMicroBitRuntime({ environment: env, microbit });
  assert.deepEqual(runtime.loadWodalProgramImage(built.image), { ok: true }, "program should load");

  for (const [index, step] of schedule.entries()) {
    tick = index + 1;
    if (step.gate !== undefined) {
      microbit.gpio.setDigitalRead(GATE_PIN, step.gate);
    }
    if (step.gate2 !== undefined) {
      microbit.gpio.setDigitalRead(GATE2_PIN, step.gate2);
    }
    runtime.tick(16);
  }

  const wheels = new Map<number, number[][]>();
  for (const [atTick, commands] of raw) {
    wheels.set(
      atTick,
      commands.map((command) => {
        const [wheel, direction, speed] = command;
        assert.ok(wheel === 0x01 || wheel === 0x02, `wheel byte should be 0x01 or 0x02, got ${wheel}`);
        return [wheel, direction === 0x01 && speed !== 0 ? -speed! : speed!];
      })
    );
  }
  return { wheels, fires, program: built.image.program };
}

/** The signed (left, right) wheel pair written on `tick`; asserts exactly one command per wheel. */
function wheelsAt(result: RunResult, tick: number): [number, number] {
  const commands = result.wheels.get(tick);
  assert.ok(commands, `expected chassis writes on tick ${tick}`);
  assert.equal(commands.length, 2, `expected exactly two wheel commands on tick ${tick}`);
  const left = commands.find((entry) => entry[0] === 0x01);
  const right = commands.find((entry) => entry[0] === 0x02);
  assert.ok(left && right, `expected one left and one right command on tick ${tick}`);
  return [left[1]!, right[1]!];
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

describe("Cutebot movement arbitrator", () => {
  test("one drive rule is identity and the wheels are re-written every think", () => {
    const env = environment.current!;
    const result = run(env, brainWithRules(env, "movement identity", [{ when: "always", do: "cutebot drive" }]), [
      {},
      {},
      {},
    ]);
    for (const tick of [1, 2, 3]) {
      assert.deepEqual(wheelsAt(result, tick), [50, 50], `bare drive writes (50, 50) on tick ${tick}`);
    }
  });

  test("the rate ladder resolves each compounded step exactly", () => {
    const env = environment.current!;
    const cases: { mods: string[]; rate: number }[] = [
      { mods: ["speed.slowly", "speed.slowly", "speed.slowly"], rate: 10 },
      { mods: ["speed.slowly", "speed.slowly"], rate: 18 },
      { mods: ["speed.slowly"], rate: 30 },
      { mods: [], rate: 50 },
      { mods: ["speed.quickly"], rate: 70 },
      { mods: ["speed.quickly", "speed.quickly"], rate: 85 },
      { mods: ["speed.quickly", "speed.quickly", "speed.quickly"], rate: 100 },
    ];
    for (const { mods, rate } of cases) {
      const label = mods.join(" ") || "bare";
      const result = run(
        env,
        brainWithRules(env, `movement ladder ${label}`, [{ when: "always", do: "cutebot drive", doMods: mods }]),
        [{}]
      );
      assert.deepEqual(wheelsAt(result, 1), [rate, rate], `${label} drives at ${rate}`);
    }
  });

  test("a document-level mixed tile resolves slowly-wins and over-cap counts clamp to the ladder", () => {
    const env = environment.current!;
    // The picker forbids both shapes; a brain document can still carry them, so
    // the ladder lookup stays total: slowly wins a mix, counts clamp at three.
    const mixed = run(
      env,
      brainWithRules(env, "movement mixed words", [
        { when: "always", do: "cutebot drive", doMods: ["speed.slowly", "speed.quickly"] },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(mixed, 1), [30, 30], "slowly wins over quickly on one tile");

    const overCap = run(
      env,
      brainWithRules(env, "movement over-cap words", [
        {
          when: "always",
          do: "cutebot drive",
          doMods: ["speed.slowly", "speed.slowly", "speed.slowly", "speed.slowly"],
        },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(overCap, 1), [10, 10], "a fourth slowly clamps to the three-word step");
  });

  test("direction words and bare-tile defaults produce the spec's wheel patterns", () => {
    const env = environment.current!;
    const cases: { name: string; tile: string; mods: string[]; wheels: [number, number] }[] = [
      { name: "drive backward", tile: "cutebot drive", mods: ["direction.backward"], wheels: [-50, -50] },
      { name: "turn bare", tile: "cutebot turn", mods: [], wheels: [50, 0] },
      { name: "turn left", tile: "cutebot turn", mods: ["direction.left"], wheels: [0, 50] },
      { name: "turn slowly", tile: "cutebot turn", mods: ["speed.slowly"], wheels: [30, 0] },
      { name: "pivot bare", tile: "cutebot pivot", mods: [], wheels: [50, -50] },
      { name: "pivot left", tile: "cutebot pivot", mods: ["direction.left"], wheels: [-50, 50] },
      { name: "pivot slowly left", tile: "cutebot pivot", mods: ["speed.slowly", "direction.left"], wheels: [-30, 30] },
    ];
    for (const { name, tile, mods, wheels } of cases) {
      const result = run(env, brainWithRules(env, `movement ${name}`, [{ when: "always", do: tile, doMods: mods }]), [
        {},
      ]);
      assert.deepEqual(wheelsAt(result, 1), wheels, `${name} writes (${wheels[0]}, ${wheels[1]})`);
    }
  });

  test("agreeing influences compound and opposing pivots cancel", () => {
    const env = environment.current!;
    const agree = run(
      env,
      brainWithRules(env, "movement agreement", [
        { when: "always", do: "cutebot drive" },
        { when: "always", do: "cutebot drive" },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(agree, 1), [100, 100], "two bare drives compound to full speed");

    const cancel = run(
      env,
      brainWithRules(env, "movement cancellation", [
        { when: "always", do: "cutebot pivot", doMods: ["direction.left"] },
        { when: "always", do: "cutebot pivot", doMods: ["direction.right"] },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(cancel, 1), [0, 0], "equal opposite pivots cancel to rest");
  });

  test("the junction surge: a drive plus both turns goes straight, faster", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement junction", [
        { when: "always", do: "cutebot drive" },
        { when: "always", do: "cutebot turn", doMods: ["direction.left"] },
        { when: "always", do: "cutebot turn", doMods: ["direction.right"] },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(result, 1), [100, 100], "mirrored turns stay straight and their pushes add");
  });

  test("a slow pivot blends with a concurrent drive into a forward arc", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement pivot blend", [
        { when: "always", do: "cutebot drive" },
        { when: "always", do: "cutebot pivot", doMods: ["speed.slowly", "direction.left"] },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(result, 1), [20, 80], "drive (50,50) + pivot slowly left (-30,30) = (20,80)");
  });

  test("stop supersedes the think in both rule orders and influences resume next think", () => {
    const env = environment.current!;
    const orders: { name: string; rules: RuleSpec[] }[] = [
      {
        name: "stop first",
        rules: [
          { when: "gate high", do: "cutebot stop" },
          { when: "always", do: "cutebot drive" },
        ],
      },
      {
        name: "stop last",
        rules: [
          { when: "always", do: "cutebot drive" },
          { when: "gate high", do: "cutebot stop" },
        ],
      },
    ];
    for (const { name, rules } of orders) {
      const result = run(env, brainWithRules(env, `movement ${name}`, rules), [{ gate: 1 }, { gate: 0 }]);
      assert.deepEqual(wheelsAt(result, 1), [0, 0], `${name}: the stop discards the concurrent drive`);
      assert.deepEqual(wheelsAt(result, 2), [50, 50], `${name}: influences resume the next think`);
    }
  });

  test("silence holds the last target for exactly the hold window, then stops", () => {
    const env = environment.current!;
    const result = run(env, brainWithRules(env, "movement silence", [{ when: "gate high", do: "cutebot drive" }]), [
      { gate: 1 },
      { gate: 0 },
      {},
      {},
      {},
      {},
    ]);
    assert.deepEqual(wheelsAt(result, 1), [50, 50], "the gated drive moves the robot");
    for (const tick of [2, 3, 4]) {
      assert.deepEqual(wheelsAt(result, tick), [50, 50], `silent tick ${tick} reuses the held target`);
    }
    assert.deepEqual(wheelsAt(result, 5), [0, 0], "the fourth silent think drops the target to rest");
    assert.deepEqual(wheelsAt(result, 6), [0, 0], "the stop holds while rules stay silent");
  });

  test("an alternating command/gap stream holds a steady full-value output", () => {
    const env = environment.current!;
    // The remote-control beat: a radio-driven brain's rules fire at packet
    // rate, so a held button produces periodic empty thinks. Each gap think
    // reuses the held target, so the output never dips.
    const result = run(env, brainWithRules(env, "movement beat", [{ when: "gate high", do: "cutebot drive" }]), [
      { gate: 1 },
      { gate: 0 },
      { gate: 1 },
      { gate: 0 },
      { gate: 1 },
      { gate: 0 },
      { gate: 1 },
      { gate: 0 },
    ]);
    for (const tick of [1, 2, 3, 4, 5, 6, 7, 8]) {
      assert.deepEqual(wheelsAt(result, tick), [50, 50], `tick ${tick} writes the full value with no dip`);
    }
  });

  test("smoothing rides the beat pattern to the full target and holds it", () => {
    const env = environment.current!;
    const schedule: Step[] = [];
    for (let index = 0; index < 44; index++) {
      schedule.push(index % 2 === 0 ? { gate: 1 } : { gate: 0 });
    }
    const result = run(
      env,
      brainWithRules(env, "movement beat smoothing", [
        { when: "always", do: "smooth heavy" },
        { when: "gate high", do: "cutebot drive" },
      ]),
      schedule
    );
    // At s=0.9 the output chases one smooth EMA curve toward 50 (binary32
    // arithmetic, per the runtime's numeric profile): the gap thinks reuse
    // the held target, so the curve never dips, the near-snap lands exactly
    // on 50 at tick 38, and the output then holds the full target through
    // commands and gaps alike.
    const curve = [
      5, 10, 14, 17, 20, 23, 26, 28, 31, 33, 34, 36, 37, 39, 40, 41, 42, 42, 43, 44, 45, 45, 46, 46, 46, 47, 47, 47, 48,
      48, 48, 48, 48, 49, 49, 49, 49, 50, 50, 50, 50, 50, 50, 50,
    ];
    for (const [index, expected] of curve.entries()) {
      assert.deepEqual(wheelsAt(result, index + 1), [expected, expected], `tick ${index + 1} writes ${expected}`);
    }
  });

  test("a stop during the hold window clears the held target", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement stop in hold", [
        { when: "gate high", do: "cutebot drive" },
        { when: "gate2 high", do: "cutebot stop" },
      ]),
      [{ gate: 1, gate2: 0 }, { gate: 0 }, { gate2: 1 }, { gate2: 0 }, {}]
    );
    assert.deepEqual(wheelsAt(result, 1), [50, 50], "the gated drive moves the robot");
    assert.deepEqual(wheelsAt(result, 2), [50, 50], "the first silent think reuses the held target");
    assert.deepEqual(wheelsAt(result, 3), [0, 0], "the stop wins over the hold window");
    assert.deepEqual(wheelsAt(result, 4), [0, 0], "a silent think after the stop does not resurrect the target");
    assert.deepEqual(wheelsAt(result, 5), [0, 0], "the robot stays at rest");
  });

  test("a fresh emission restarts the hold window", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement hold restart", [{ when: "gate high", do: "cutebot drive" }]),
      [{ gate: 1 }, { gate: 0 }, {}, { gate: 1 }, { gate: 0 }, {}, {}, {}]
    );
    // Command, two gaps, command, three gaps: the second command restarts the
    // window, so the target survives five total gap thinks and expires exactly
    // three thinks after the last emission.
    for (const tick of [1, 2, 3, 4, 5, 6, 7]) {
      assert.deepEqual(wheelsAt(result, tick), [50, 50], `tick ${tick} holds the target`);
    }
    assert.deepEqual(wheelsAt(result, 8), [0, 0], "the restarted window expires three thinks after the last command");
  });

  test("a page switch stops the robot and the arbitrator keeps ticking page-independently", () => {
    const env = environment.current!;
    const brainDef = BrainDef.emptyBrainDef(env.brainServices, "movement page switch");
    const page0 = brainDef.pages().get(0)!;
    const appended = brainDef.appendNewPage();
    assert.ok(appended.success);
    const page1 = appended.value.page;

    const driveRule = page0.children().get(0)!;
    driveRule.when().appendTile(userTile("always"));
    driveRule.do().appendTile(userTile("cutebot drive"));

    const switchRule = page0.appendNewRule();
    assert.ok(switchRule);
    switchRule.when().appendTile(userTile("gate high"));
    switchRule.do().appendTile(coreTile(env, mkActuatorTileId(CoreHostActions.SwitchPage.key)));
    switchRule.do().appendTile(pageArgTile(brainDef, page1));

    // Page 1 has no movement rules, so the switch silences every influence;
    // the hold window carries the last target for three thinks, then stops.
    const result = run(env, brainDef, [{ gate: 0 }, { gate: 1 }, { gate: 0 }, {}, {}, {}]);
    assert.deepEqual(wheelsAt(result, 1), [50, 50], "the page-0 drive moves the robot");
    for (const tick of [3, 4, 5]) {
      assert.deepEqual(wheelsAt(result, tick), [50, 50], `the hold carries the last target on tick ${tick}`);
    }
    assert.deepEqual(wheelsAt(result, 6), [0, 0], "after the switch the hold expires and the robot stops");
  });

  test("scale-preserving saturation keeps the wheel ratio of an over-limit arc", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement saturation", [
        { when: "always", do: "cutebot drive", doMods: ["speed.quickly", "speed.quickly", "speed.quickly"] },
        { when: "always", do: "cutebot turn" },
      ]),
      [{}]
    );
    // Sum (150, 100) scales by 100/150 to (100, 66.67): the 3:2 ratio survives
    // where independent clamping would have written (100, 100).
    assert.deepEqual(wheelsAt(result, 1), [100, 67], "both wheels scale by 100/max");
  });

  test("drift trims proportionally at two speeds and the held wheel stays exactly zero", () => {
    const env = environment.current!;
    const withDrift = (name: string, moveRule: RuleSpec): RunResult =>
      run(env, brainWithRules(env, name, [{ when: "always", do: "calibrate drift" }, moveRule]), [{}, {}]);

    // d=12 gains the left wheel by 1.06 and the right by 0.94.
    const fast = withDrift("movement drift fast", { when: "always", do: "cutebot drive" });
    assert.deepEqual(wheelsAt(fast, 2), [53, 47], "bare drive 50 trims to (53, 47)");

    const slow = withDrift("movement drift slow", { when: "always", do: "cutebot drive", doMods: ["speed.slowly"] });
    assert.deepEqual(wheelsAt(slow, 2), [32, 28], "slowly drive 30 trims to (32, 28): the correction scales");

    const held = withDrift("movement drift held wheel", { when: "always", do: "cutebot turn" });
    assert.deepEqual(wheelsAt(held, 2), [53, 0], "the held wheel stays exactly 0 under turn + drift");

    const rest = run(env, brainWithRules(env, "movement drift rest", [{ when: "always", do: "calibrate drift" }]), [
      {},
      {},
    ]);
    assert.deepEqual(wheelsAt(rest, 2), [0, 0], "wheels stay exactly 0 at rest with drift set");
  });

  test("config setters clamp and the getters report the applied values", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement config", [
        { when: "always", do: "calibrate drift over" },
        { when: "always", do: "smooth half" },
        { when: "drift clamped", do: "mark drift" },
        { when: "smoothing set", do: "mark smoothing" },
      ]),
      [{}, {}]
    );
    // The setters run during tick 1, so both getter probes observe the applied
    // values from tick 2 on.
    assert.deepEqual(
      marksAt(result, 2),
      [MARK.driftClamped, MARK.smoothingSet],
      "setDrift(40) reads back 25 and setSmoothing(0.5) reads back 0.5"
    );

    const clamped = run(
      env,
      brainWithRules(env, "movement drift clamp", [
        { when: "always", do: "calibrate drift over" },
        { when: "always", do: "cutebot drive" },
      ]),
      [{}, {}]
    );
    // The clamped d=25 gains 1.125 / 0.875: 50 -> (56.25, 43.75).
    assert.deepEqual(wheelsAt(clamped, 2), [56, 44], "the clamped trim drives the wheel math");
  });

  test("smoothing chases the target on the exact EMA curve and the near-snap terminates it", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement smoothing curve", [
        { when: "always", do: "smooth half" },
        { when: "always", do: "cutebot drive" },
      ]),
      [{}, {}, {}, {}, {}, {}, {}]
    );
    // s=0.5 halves the gap each think: 25, 37.5, 43.75, 46.875, 48.4375, then
    // the gap falls under 1 and the near-snap lands the output exactly on 50.
    const curve = [25, 38, 44, 47, 48, 50, 50];
    for (const [index, expected] of curve.entries()) {
      assert.deepEqual(wheelsAt(result, index + 1), [expected, expected], `tick ${index + 1} writes ${expected}`);
    }
  });

  test("smoothing glides the post-hold decay through the stop deadband to exact rest", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement smoothing decay", [
        { when: "always", do: "smooth half" },
        { when: "gate high", do: "cutebot drive" },
      ]),
      [{ gate: 1 }, { gate: 1 }, { gate: 0 }, {}, {}, {}, {}, {}, {}, {}, {}]
    );
    // Ramp up for two thinks (25, 37.5); the three hold thinks keep chasing
    // the held target of 50 (43.75, 46.875, 48.4375); then the target drops to
    // 0 and the output halves each think: 24.21875, 12.109375, 6.0546875,
    // 3.02734375, then 1.51 falls inside the |out| < 2 deadband and writes 0,
    // and the near-snap zeroes the state exactly one think later.
    const curve = [25, 38, 44, 47, 48, 24, 12, 6, 3, 0, 0];
    for (const [index, expected] of curve.entries()) {
      assert.deepEqual(wheelsAt(result, index + 1), [expected, expected], `tick ${index + 1} writes ${expected}`);
    }
  });

  test("stop bypasses smoothing and zeroes the smoothing state", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement stop bypass", [
        { when: "always", do: "smooth half" },
        { when: "always", do: "cutebot drive" },
        { when: "gate high", do: "cutebot stop" },
      ]),
      [{ gate: 0 }, {}, { gate: 1 }, { gate: 0 }]
    );
    assert.deepEqual(wheelsAt(result, 1), [25, 25], "the ramp starts");
    assert.deepEqual(wheelsAt(result, 2), [38, 38], "the ramp continues");
    assert.deepEqual(wheelsAt(result, 3), [0, 0], "stop writes zero immediately, mid-ramp");
    assert.deepEqual(wheelsAt(result, 4), [25, 25], "the resumed ramp restarts from a zeroed state");
  });

  test("two callsites blend through the one shared System", () => {
    const env = environment.current!;
    const result = run(
      env,
      brainWithRules(env, "movement multiplicity", [
        { when: "always", do: "cutebot drive" },
        { when: "always", do: "cutebot turn", doMods: ["direction.left"] },
      ]),
      [{}]
    );
    assert.deepEqual(wheelsAt(result, 1), [50, 100], "drive (50,50) + turn left (0,50) blend to (50,100)");
    assert.equal(systemCount(result), 1, "two movement callsites register exactly one System");
  });

  test("a brain that reaches no movement code never touches the chassis", () => {
    const env = environment.current!;
    const result = run(env, brainWithRules(env, "movement unreachable", [{ when: "always", do: "mark plain" }]), [
      {},
      {},
    ]);
    assert.equal(systemCount(result), 0, "the Movement System is not registered");
    assert.equal(result.wheels.size, 0, "no chassis write ever happens");
    for (const tick of [1, 2]) {
      assert.deepEqual(marksAt(result, tick), [MARK.plain], `the plain brain still runs on tick ${tick}`);
    }
  });

  test("the picker offers the shared rate words on all three moving tiles and none on stop", () => {
    const env = environment.current!;
    const offered = (tile: string, mods: readonly string[]): Set<string> => {
      const tiles = [userTile(tile), ...mods.map(sharedModifier)];
      const expr = parseTilesForSuggestions(List.from(tiles));
      const ctx: InsertionContext = { ruleSide: RuleSide.Do, expr };
      const result = suggestTiles(ctx, List.from([...env.tileCatalogs()]), env.brainServices);
      const ids = new Set<string>();
      for (let i = 0; i < result.exact.size(); i++) ids.add(result.exact.get(i).tileDef.tileId);
      return ids;
    };
    const slowlyId = mkModifierTileId("modifier.speed.slowly");
    const quicklyId = mkModifierTileId("modifier.speed.quickly");

    for (const tile of ["cutebot drive", "cutebot turn", "cutebot pivot"]) {
      const bare = offered(tile, []);
      assert.ok(bare.has(slowlyId), `${tile} offers slowly`);
      assert.ok(bare.has(quicklyId), `${tile} offers quickly`);
    }
    assert.ok(!offered("cutebot stop", []).has(slowlyId), "stop offers no rate words");

    const afterOne = offered("cutebot drive", ["speed.slowly"]);
    assert.ok(afterOne.has(slowlyId), "slowly repeats after one placement");
    assert.ok(!afterOne.has(quicklyId), "quickly is locked out once slowly is placed");

    const afterThree = offered("cutebot drive", ["speed.slowly", "speed.slowly", "speed.slowly"]);
    assert.ok(!afterThree.has(slowlyId), "slowly stops repeating at the cap of three");

    const afterForward = offered("cutebot drive", ["direction.forward"]);
    assert.ok(
      !afterForward.has(mkModifierTileId("modifier.direction.backward")),
      "backward is locked out once forward is placed"
    );
  });
});
