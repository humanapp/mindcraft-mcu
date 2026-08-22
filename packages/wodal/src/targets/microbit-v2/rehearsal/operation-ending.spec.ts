/**
 * What a rehearsal of this device records of the display operations its brain
 * starts: one the display would not take, one another call interrupted, and one
 * that ran on to its own end after the call that started it had returned.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AuthoringWorkspace, DispatchObservation, ScenarioInput, SimulationRun } from "@wendoo/assistant-bridge";
import { createAuthoringWorkspace, DispatchOutcome, proposeEdit, summarizeRun } from "@wendoo/assistant-bridge";
import { FAKE_TARGET_IDENTITY, ruleIdAt } from "@wendoo/assistant-bridge/testing";
import { mkActuatorTileId, mkModifierTileId, mkSensorTileId } from "@wendoo/core/app";
import { CoreLiteralFactoryId, mkLiteralFactoryTileId } from "@wendoo/core/brain";
import { SCROLL_DEFAULT_DELAY_MS, scrollDurationMs } from "../wendoo/display-scroll";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId } from "../wendoo/tile-ids";
import { createTargetAdapter } from "./adapter";

/** The one role a scenario may put under study. */
const SUBJECT = "device";

/** Simulated milliseconds one think advances the device, as this target's world steps it. */
const THINK_STEP_MS = 16;

/** The text every scrolling rule below shows. */
const SCROLL_TEXT = "hi";

/** Thinks a scroll of {@link SCROLL_TEXT} holds the display before it ends on its own. */
const SCROLL_THINKS = scrollDurationMs(SCROLL_TEXT.length, SCROLL_DEFAULT_DELAY_MS) / THINK_STEP_MS;

/** One tile of a rule side, by id or as a factory naming what to mint. */
type Placement = string | { tileId: string; value: string };

/** The DO side of a rule that scrolls {@link SCROLL_TEXT}, with `modifiers` attached. */
function scrolls(...modifiers: readonly string[]): Placement[] {
  return [
    mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key),
    { tileId: mkLiteralFactoryTileId(CoreLiteralFactoryId.String), value: SCROLL_TEXT },
    ...modifiers,
  ];
}

/** Fill the rule at `rulePath` so it senses `sensorKey` and does `does`. */
function withRule(workspace: AuthoringWorkspace, rulePath: string, sensorKey: string, does: Placement[]): void {
  const ruleId = ruleIdAt(workspace.brainDef, rulePath);
  for (const [side, tileIds] of [
    ["when", [mkSensorTileId(sensorKey)] as Placement[]],
    ["do", does],
  ] as const) {
    const result = proposeEdit(workspace, { op: "placeTiles", ruleId, side, tileIds });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
}

/** A fresh workspace on this target, with room for `extraRules` rules beyond the first. */
function workspaceOf(extraRules: number): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(FAKE_TARGET_IDENTITY), "display lease brain");
  for (let index = 0; index < extraRules; index++) {
    const added = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });
    assert.equal(added.ok, true, JSON.stringify(added));
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

/** Every dispatch of `action` the run recorded, in order. */
function dispatchesOf(run: SimulationRun, action: string): DispatchObservation[] {
  return run.observations.flatMap((think) => think.dispatches.filter((dispatch) => dispatch.action === action));
}

/** One press of `kind`, held for a single think. */
function press(kind: string, at: number): ScenarioInput[] {
  return [
    { kind, at, value: true },
    { kind, at: at + 1, value: false },
  ];
}

describe("a display already busy", () => {
  test("reports the call it turned away as dropped", async () => {
    const workspace = workspaceOf(1);
    withRule(workspace, "0/0", MicroBitV2HostActions.ButtonA.key, scrolls());
    withRule(workspace, "0/1", MicroBitV2HostActions.ButtonB.key, [
      mkActuatorTileId(MicroBitV2HostActions.DrawImage.key),
    ]);

    const run = await rehearse(workspace, [...press("button-a", 2), ...press("button-b", 6)], 20);

    const draws = dispatchesOf(run, MicroBitV2HostActions.DrawImage.key);
    assert.equal(draws.length, 1);
    assert.equal(draws[0]?.outcome, DispatchOutcome.Dropped);
    assert.equal(draws[0]?.settledAfter, undefined, "a dropped call never started, so it took no time");
  });
});

describe("a display taken by another rule", () => {
  test("reports the interrupted call as preempted, at the think it lost the lease", async () => {
    const workspace = workspaceOf(1);
    withRule(workspace, "0/0", MicroBitV2HostActions.ButtonA.key, scrolls());
    withRule(workspace, "0/1", MicroBitV2HostActions.ButtonLogo.key, [
      mkActuatorTileId(MicroBitV2HostActions.DisplayClear.key),
    ]);

    const run = await rehearse(workspace, [...press("button-a", 2), ...press("logo-touch", 12)], 20);

    const scroll = dispatchesOf(run, MicroBitV2HostActions.DisplayScroll.key)[0];
    assert.equal(scroll?.outcome, DispatchOutcome.Preempted);
    assert.equal(scroll?.settledAfter, 10, "the scroll ended on the think the screen was wiped");
    assert.ok(
      summarizeRun(run).dispatchTotals.some((entry) => entry.includes(`[${DispatchOutcome.Preempted},+10]`)),
      `the account carries the ending: ${summarizeRun(run).dispatchTotals.join(" ")}`
    );
  });
});

describe("a show running in the background", () => {
  test("reports its own end long after the call that started it returned", async () => {
    const workspace = workspaceOf(0);
    withRule(
      workspace,
      "0/0",
      MicroBitV2HostActions.ButtonA.key,
      scrolls(mkModifierTileId(WodalMicroBitV2ModifierId.InBackground))
    );

    const run = await rehearse(workspace, press("button-a", 2), SCROLL_THINKS + 5);

    const scroll = dispatchesOf(run, MicroBitV2HostActions.DisplayScroll.key)[0];
    assert.equal(scroll?.outcome, DispatchOutcome.BackgroundEnd);
    assert.equal(scroll?.settledAfter, SCROLL_THINKS);
    assert.ok(
      run.observations.every((think) => think.waiting === undefined),
      "no rule ever parked on a show started in the background"
    );
  });
});

describe("one run holding all three endings", () => {
  test("renders each of them in the account it hands back", async () => {
    const workspace = workspaceOf(2);
    withRule(
      workspace,
      "0/0",
      MicroBitV2HostActions.ButtonA.key,
      scrolls(mkModifierTileId(WodalMicroBitV2ModifierId.InBackground))
    );
    withRule(workspace, "0/1", MicroBitV2HostActions.ButtonB.key, [
      mkActuatorTileId(MicroBitV2HostActions.DrawImage.key),
    ]);
    withRule(workspace, "0/2", MicroBitV2HostActions.ButtonLogo.key, [
      mkActuatorTileId(MicroBitV2HostActions.DisplayClear.key),
    ]);

    const run = await rehearse(
      workspace,
      [...press("button-a", 2), ...press("button-b", 6), ...press("logo-touch", 12), ...press("button-a", 20)],
      SCROLL_THINKS + 30
    );

    const endings = dispatchesOf(run, MicroBitV2HostActions.DisplayScroll.key)
      .concat(dispatchesOf(run, MicroBitV2HostActions.DrawImage.key))
      .map((dispatch) => dispatch.outcome);
    assert.deepEqual(endings.sort(), [
      DispatchOutcome.BackgroundEnd,
      DispatchOutcome.Dropped,
      DispatchOutcome.Preempted,
    ]);
  });
});
