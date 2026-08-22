import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, ScenarioInput, SimulationRun } from "@wendoo-lang/assistant-bridge";
import { createAuthoringWorkspace, proposeEdit } from "@wendoo-lang/assistant-bridge";
import { ScenarioRejection, ScenarioRejectionCode } from "@wendoo-lang/assistant-bridge/kit";
import { ConformanceCheckCode, checkAdapterConformance } from "@wendoo-lang/assistant-bridge/kit/node";
import { FAKE_TARGET_IDENTITY, ruleIdAt } from "@wendoo-lang/assistant-bridge/testing";
import { mkActuatorTileId, mkParameterTileId, mkSensorTileId } from "@wendoo-lang/core/app";
import { CoreLiteralFactoryId, mkLiteralFactoryTileId } from "@wendoo-lang/core/brain";
import { MICROBIT_V2_TILE_DOCS } from "../wendoo/tile-docs";
import { MicroBitV2HostActions, WodalMicroBitV2ParameterId } from "../wendoo/tile-ids";
import { createTargetAdapter } from "./adapter";
import { PERCEPT_KINDS } from "./world";

/** Fixed-step thinks each conformance run covers. */
const RUN_THINKS = 60;

/** The one role this target puts under study, taken from the adapter itself. */
const SUBJECT = createTargetAdapter(FAKE_TARGET_IDENTITY).subjects()[0]!;

/**
 * A scripted press of button A: down before think 10, up before think 20, with
 * the room going dark before think 30.
 */
const PERCEPT_SCHEDULE: readonly ScenarioInput[] = [
  { kind: "button-a", at: 10, value: true },
  { kind: "button-a", at: 20, value: false },
  { kind: "light-level", at: 30, value: 12 },
];

/** Scenario the conformance runs stage. */
const SCENARIO = { seed: 20260806, subject: SUBJECT, inputs: PERCEPT_SCHEDULE };

/**
 * A workspace carrying one rule: when button A is pressed, light the pixel at
 * column 2, row 3.
 */
function authoredWorkspace(): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(FAKE_TARGET_IDENTITY), "conformance brain");
  const when = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: ruleIdAt(workspace.brainDef, "0/0"),
    side: "when",
    tileIds: [mkSensorTileId(MicroBitV2HostActions.ButtonA.key)],
  });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: ruleIdAt(workspace.brainDef, "0/0"),
    side: "do",
    tileIds: [
      mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key),
      mkParameterTileId(WodalMicroBitV2ParameterId.X),
      { tileId: mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), value: 2 },
      mkParameterTileId(WodalMicroBitV2ParameterId.Y),
      { tileId: mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), value: 3 },
    ],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return workspace;
}

/** What a run recorded, which the same seed and schedule must reproduce exactly. */
function recorded(run: SimulationRun): Omit<SimulationRun, "runId"> {
  const { runId: _addressedAs, ...rest } = run;
  return rest;
}

/** Run the authored brain against `SCENARIO`. */
async function rehearse(workspace: AuthoringWorkspace): Promise<SimulationRun> {
  return workspace.adapter.run({ brainDef: workspace.brainDef, scenario: SCENARIO, thinks: RUN_THINKS });
}

describe("the device adapter against the bridge's conformance suite", () => {
  test("is deterministic, bounded, and observes the brain's gates", async () => {
    const workspace = authoredWorkspace();

    const report = await checkAdapterConformance({
      adapter: workspace.adapter,
      brainDef: workspace.brainDef,
      scenario: SCENARIO,
      thinks: RUN_THINKS,
    });

    for (const check of report.checks) {
      assert.equal(check.ok, true, `${check.code}: ${check.detail}`);
    }
    assert.deepEqual(
      report.checks.map((check) => check.code),
      [
        ConformanceCheckCode.Determinism,
        ConformanceCheckCode.Boundedness,
        ConformanceCheckCode.GateEvents,
        ConformanceCheckCode.ChildRuleObservation,
        ConformanceCheckCode.UserTileObservation,
      ]
    );
    assert.equal(report.ok, true);
  });

  test("registers the percept kinds its world applies, and one device role", () => {
    const adapter = createTargetAdapter(FAKE_TARGET_IDENTITY);

    assert.deepEqual(adapter.inputKinds(), PERCEPT_KINDS);
    assert.equal(adapter.subjects().length, 1);
    for (const kind of PERCEPT_KINDS) assert.ok(kind.description.length > 0, kind.name);
  });

  test("refuses a scenario scripting a percept kind it does not register", async () => {
    const workspace = authoredWorkspace();

    await assert.rejects(
      workspace.adapter.run({
        brainDef: workspace.brainDef,
        scenario: { seed: 1, subject: SUBJECT, inputs: [{ kind: "sonar-distance", at: 0, value: 4 }] },
        thinks: 4,
      }),
      (error: unknown) =>
        error instanceof ScenarioRejection &&
        error.code === ScenarioRejectionCode.UnknownInputKind &&
        error.named.length === 1 &&
        error.offered.join(",") === PERCEPT_KINDS.map((kind) => kind.name).join(",")
    );
  });

  test("ships a documentation page for every tile its manifest names, and names every page it ships", () => {
    const docs = createTargetAdapter(FAKE_TARGET_IDENTITY).tileDocs();

    assert.equal(docs.size, MICROBIT_V2_TILE_DOCS.length);
  });
});

describe("a scripted percept schedule", () => {
  test("flips the rule's gate on the think the scripted press lands, and on no other", async () => {
    const run = await rehearse(authoredWorkspace());

    const firedThinks = run.observations
      .map((think, index) => (think.gates.some((gate) => gate.fired) ? index : -1))
      .filter((index) => index >= 0);

    assert.deepEqual(firedThinks, [10]);
    assert.ok(
      run.observations.every((think) => think.gates.length > 0),
      "the gate is evaluated on every think"
    );
  });

  test("dispatches the actuator with the arguments the rule carries", async () => {
    const workspace = authoredWorkspace();
    const run = await rehearse(workspace);

    const dispatches = run.observations.flatMap((think) => think.dispatches);
    const pixels = dispatches.filter((dispatch) => dispatch.action === MicroBitV2HostActions.DisplaySetPixel.key);

    assert.equal(pixels.length, 1);
    assert.deepEqual(pixels[0]?.args, ["x=2", "y=3"]);
    assert.equal(pixels[0]?.ruleId, ruleIdAt(workspace.brainDef, "0/0"));
  });

  test("reproduces the same run from the same seed and schedule", async () => {
    const workspace = authoredWorkspace();
    const first = await rehearse(workspace);
    const second = await rehearse(workspace);

    assert.equal(JSON.stringify(recorded(first)), JSON.stringify(recorded(second)));
    assert.notEqual(first.runId, second.runId, "each rehearsal is addressable on its own");
    assert.equal(first.thinks, RUN_THINKS);
    assert.deepEqual(first.world, { initialPopulation: 1, finalPopulation: 1, brainsExecuted: 1 });
  });
});
