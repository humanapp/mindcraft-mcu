import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, ScenarioInput, SimulationRun } from "@wendoo-lang/assistant-bridge";
import { createAuthoringWorkspace, proposeEdit } from "@wendoo-lang/assistant-bridge";
import { FAKE_TARGET_IDENTITY, ruleIdAt } from "@wendoo-lang/assistant-bridge/testing";
import {
  CoreTypeIds,
  mkActuatorTileId,
  mkOutputTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@wendoo-lang/core/app";
import { CoreLiteralFactoryId, mkLiteralFactoryTileId } from "@wendoo-lang/core/brain";
import { DEFAULT_TEMPERATURE } from "../../../core/thermometer";
import { MicroBitV2HostActions, WodalMicroBitV2ParameterId } from "../wendoo/tile-ids";
import { createTargetAdapter } from "./adapter";

/** The one role a scenario may put under study. */
const SUBJECT = "device";

/** One tile of a rule side, by id or as a factory naming what to mint. */
type Placement = string | { tileId: string; value: number | string };

/** Number literal `value`, as a rule side carries it. */
function number(value: number): Placement {
  return { tileId: mkLiteralFactoryTileId(CoreLiteralFactoryId.Number), value };
}

/**
 * A brain of one rule carrying `when` and `does`, over a fresh workspace on
 * this target.
 */
function workspaceWithRule(when: readonly Placement[], does: readonly Placement[]): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(FAKE_TARGET_IDENTITY), "percept brain");
  const ruleId = ruleIdAt(workspace.brainDef, "0/0");
  for (const [side, tileIds] of [
    ["when", when],
    ["do", does],
  ] as const) {
    if (tileIds.length === 0) continue;
    const result = proposeEdit(workspace, { op: "placeTiles", ruleId, side, tileIds: [...tileIds] });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  return workspace;
}

/** Rehearse `workspace` over `inputs` for `thinks` thinks. */
function rehearse(
  workspace: AuthoringWorkspace,
  inputs: readonly ScenarioInput[],
  thinks: number
): Promise<SimulationRun> {
  return workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: { seed: 20260810, subject: SUBJECT, inputs },
    thinks,
  });
}

/** The WHEN result the run's one rule produced on each think, in order. */
function gateResults(run: SimulationRun): string[] {
  return run.observations.map((think) => think.gates[0]?.result ?? "");
}

/** A harmless DO side: light the pixel at the top-left corner. */
const lightAPixel: readonly Placement[] = [
  mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key),
  mkParameterTileId(WodalMicroBitV2ParameterId.X),
  number(0),
  mkParameterTileId(WodalMicroBitV2ParameterId.Y),
  number(0),
];

describe("a scripted temperature", () => {
  test("reaches the temperature sensor, and holds until another entry changes it", async () => {
    const run = await rehearse(
      workspaceWithRule([mkSensorTileId(MicroBitV2HostActions.Temperature.key)], lightAPixel),
      [
        { kind: "temperature", at: 2, value: 31 },
        { kind: "temperature", at: 5, value: -4 },
      ],
      8
    );

    assert.deepEqual(gateResults(run), [
      String(DEFAULT_TEMPERATURE),
      String(DEFAULT_TEMPERATURE),
      "31",
      "31",
      "31",
      "-4",
      "-4",
      "-4",
    ]);
  });
});

describe("a scripted shake", () => {
  test("is felt by the gesture sensor, and passes", async () => {
    const run = await rehearse(
      workspaceWithRule([mkSensorTileId(MicroBitV2HostActions.Gesture.key)], lightAPixel),
      [{ kind: "gesture", at: 0, value: "shake" }],
      40
    );

    const felt = gateResults(run)
      .map((result, think) => (result === "true" ? think : -1))
      .filter((think) => think >= 0);
    assert.ok(felt.length > 0, `the shake was felt on some think: ${JSON.stringify(gateResults(run))}`);
    assert.equal(gateResults(run)[0], "false", "the device is at rest before the shake is played");
  });

  test("a held tilt stays felt while an unscripted gesture is not", async () => {
    const run = await rehearse(
      workspaceWithRule([mkSensorTileId(MicroBitV2HostActions.Gesture.key)], lightAPixel),
      [{ kind: "gesture", at: 0, value: "tilt left" }],
      30
    );

    assert.ok(
      gateResults(run).every((result) => result === "false"),
      "the shake the bare sensor reads never fires for a tilt"
    );
  });
});

describe("a scripted radio message", () => {
  test("arrives at the number receiver once, on the think it names", async () => {
    const run = await rehearse(
      workspaceWithRule([mkSensorTileId(MicroBitV2HostActions.RadioReceiveNumber.key)], lightAPixel),
      [{ kind: "radio-message-number", at: 3, value: 7 }],
      6
    );

    const fired = run.observations.map((think) => think.gates[0]?.fired ?? false);
    assert.deepEqual(fired, [false, false, false, true, false, false]);
    assert.equal(gateResults(run)[3], "7");
  });

  test("arrives at the string receiver carrying its text", async () => {
    const run = await rehearse(
      workspaceWithRule([mkSensorTileId(MicroBitV2HostActions.RadioReceiveString.key)], lightAPixel),
      [{ kind: "radio-message-string", at: 2, value: "go" }],
      5
    );

    const fired = run.observations.map((think) => think.gates[0]?.fired ?? false);
    assert.deepEqual(fired, [false, false, true, false, false]);
    assert.match(gateResults(run)[2] ?? "", /go/);
  });

  test("carries the scripted signal strength, and a sensible one when none is scripted", async () => {
    const reading = (inputs: readonly ScenarioInput[]): Promise<SimulationRun> =>
      rehearse(
        workspaceWithRule(
          [mkSensorTileId(MicroBitV2HostActions.RadioReceiveNumber.key)],
          [
            mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key),
            mkParameterTileId(WodalMicroBitV2ParameterId.X),
            number(0),
            mkParameterTileId(WodalMicroBitV2ParameterId.Y),
            mkOutputTileId(CoreTypeIds.Number, "rssi"),
          ]
        ),
        inputs,
        5
      );
    const message: ScenarioInput = { kind: "radio-message-number", at: 2, value: 7 };
    const pixelArgs = (run: SimulationRun): readonly string[] | undefined =>
      run.observations[2]?.dispatches.find((dispatch) => dispatch.action === MicroBitV2HostActions.DisplaySetPixel.key)
        ?.args;

    const byDefault = await reading([message]);
    const scripted = await reading([{ kind: "radio-signal-strength", at: 0, value: 70 }, message]);

    assert.deepEqual(pixelArgs(byDefault), ["x=0", "y=-42"]);
    assert.deepEqual(pixelArgs(scripted), ["x=0", "y=-70"]);
  });
});
