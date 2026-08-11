import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, ScenarioInput, SimulationRun } from "@mindcraft-lang/assistant-bridge";
import { createAuthoringWorkspace, proposeEdit } from "@mindcraft-lang/assistant-bridge";
import { FAKE_TARGET_IDENTITY, ruleIdAt } from "@mindcraft-lang/assistant-bridge/testing";
import { mkActuatorTileId, mkParameterTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import { CoreLiteralFactoryId, mkLiteralFactoryTileId } from "@mindcraft-lang/core/brain";
import { MicroBitV2HostActions, WodalMicroBitV2ParameterId } from "../mindcraft/tile-ids";
import { createTargetAdapter } from "./adapter";

/** Fixed-step thinks each rehearsal covers. */
const RUN_THINKS = 60;

/** A press of each button, each held for ten thinks. */
const PERCEPT_SCHEDULE: readonly ScenarioInput[] = [
  { kind: "button-a", at: 10, value: true },
  { kind: "button-a", at: 20, value: false },
  { kind: "button-b", at: 30, value: true },
  { kind: "button-b", at: 40, value: false },
];

/** Scenario every rehearsal in this file stages. */
const SCENARIO = {
  seed: 20260808,
  subject: createTargetAdapter(FAKE_TARGET_IDENTITY).subjects()[0]!,
  inputs: PERCEPT_SCHEDULE,
};

/** A workspace carrying one rule: while `button` is held, light the pixel at (`x`, `y`). */
function authoredWorkspace(button: string, x: number, y: number): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(FAKE_TARGET_IDENTITY), "isolation brain");
  const when = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: ruleIdAt(workspace.brainDef, "0/0"),
    side: "when",
    tileIds: [mkSensorTileId(button)],
  });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: ruleIdAt(workspace.brainDef, "0/0"),
    side: "do",
    tileIds: [
      mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key),
      mkParameterTileId(WodalMicroBitV2ParameterId.X),
      { tileId: mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), value: x },
      mkParameterTileId(WodalMicroBitV2ParameterId.Y),
      { tileId: mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), value: y },
    ],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return workspace;
}

/** A workspace watching the A button. */
function watchingButtonA(): AuthoringWorkspace {
  return authoredWorkspace(MicroBitV2HostActions.ButtonA.key, 2, 3);
}

/** A workspace watching the B button. */
function watchingButtonB(): AuthoringWorkspace {
  return authoredWorkspace(MicroBitV2HostActions.ButtonB.key, 1, 4);
}

/**
 * Hex SHA-256 of a whole run, with each rule id replaced by the order its rule
 * was first observed in.
 */
function digestRun(run: SimulationRun): string {
  const ordinals = new Map<string, string>();
  const ordinalOf = (ruleId: string): string => {
    const seen = ordinals.get(ruleId);
    if (seen !== undefined) return seen;
    const ordinal = `rule-${ordinals.size}`;
    ordinals.set(ruleId, ordinal);
    return ordinal;
  };
  const observations = run.observations.map((think) => ({
    ...think,
    gates: think.gates.map((gate) => ({ ...gate, ruleId: ordinalOf(gate.ruleId) })),
    dispatches: think.dispatches.map((dispatch) =>
      dispatch.ruleId === undefined ? dispatch : { ...dispatch, ruleId: ordinalOf(dispatch.ruleId) }
    ),
  }));
  return createHash("sha256")
    .update(JSON.stringify({ ...run, observations }))
    .digest("hex");
}

/** Rehearse `workspace` against {@link SCENARIO}. */
function rehearse(workspace: AuthoringWorkspace): Promise<SimulationRun> {
  return workspace.adapter.run({ brainDef: workspace.brainDef, scenario: SCENARIO, thinks: RUN_THINKS });
}

describe("two device adapters in one process", () => {
  test("each rehearses what it rehearses alone", async () => {
    const soloA = digestRun(await rehearse(watchingButtonA()));
    const soloB = digestRun(await rehearse(watchingButtonB()));
    assert.notEqual(soloA, soloB, "the two brains rehearse differently");

    const a = watchingButtonA();
    const b = watchingButtonB();
    assert.equal(digestRun(await rehearse(a)), soloA);
    assert.equal(digestRun(await rehearse(b)), soloB);
  });

  test("each rehearses what it rehearses alone when both runs are in flight at once", async () => {
    const soloA = digestRun(await rehearse(watchingButtonA()));
    const soloB = digestRun(await rehearse(watchingButtonB()));
    assert.notEqual(soloA, soloB, "the two brains rehearse differently");

    const [a, b] = await Promise.all([rehearse(watchingButtonA()), rehearse(watchingButtonB())]);
    assert.equal(digestRun(a), soloA);
    assert.equal(digestRun(b), soloB);
  });
});
