/**
 * Multiplicity gating test for the radio receive sensor output tiles. The output
 * tiles are gated by identity key: an output value-tile is offered downstream
 * only when a sensor listing its `outputKey` in `providedOutputs` is present in
 * the rule hierarchy (`__out.<typeId>.<name>`, a globally unique identity). This
 * exercises the gating with more than one output provider registered together -
 * the three built-in radio receive sensors plus a compiled user-tile sensor
 * declaring an unrelated numeric output - and asserts the offered/hidden matrix
 * for each provider. Distinct identities must not cross-gate (a provider must not
 * surface another provider's output tile), and the shared `signal strength`
 * identity must surface under both radio sensors. A single-provider test cannot
 * see a cross-gate, so this test keeps two providers in play.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { UniqueSet } from "@mindcraft-lang/core";
import {
  BrainTileOutputDef,
  CoreTypeIds,
  type MindcraftEnvironment,
  mkOutputTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import type { IBrainRuleDef, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { createMicroBitV2Environment } from "./environment";
import { MicroBitV2HostActions } from "./tile-ids";

// A user-tile sensor declaring a numeric `speed` output - a distinct identity
// from any radio output, registered alongside the built-in radio sensors.
const USER_SENSOR_SOURCE = `import { Sensor, setOutput, type Context } from "mindcraft";

export default Sensor({
  name: "user-speed",
  outputs: [{ name: "speed", type: "number" }],
  onExecute(ctx: Context): boolean {
    setOutput(ctx, "speed", 5);
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.wodal.d.ts", content: readText("../../../../ambient/mindcraft.wodal.d.ts") },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "sensor" | "output"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile, `expected a ${kind} tile in the bundle`);
  return tile;
}

/** Installs the user-tile sensor into the environment and returns its sensor + output tiles. */
function installUserSensor(environment: MindcraftEnvironment): { sensor: IBrainTileDef; output: BrainTileOutputDef } {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(new Map([["user-speed.ts", USER_SENSOR_SOURCE]]));
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);
  const output = findBundleTile(bundle.tiles, "output");
  assert.ok(output instanceof BrainTileOutputDef);
  return { sensor: findBundleTile(bundle.tiles, "sensor"), output };
}

function getTile(environment: MindcraftEnvironment, tileId: string): IBrainTileDef {
  const tile = environment.brainServices.edit.tiles.get(tileId);
  assert.ok(tile, `tile '${tileId}' should be registered`);
  return tile;
}

function getOutputTile(environment: MindcraftEnvironment, typeId: string, name: string): BrainTileOutputDef {
  const tile = getTile(environment, mkOutputTileId(typeId, name));
  assert.ok(tile instanceof BrainTileOutputDef);
  return tile;
}

/**
 * The output identity keys provided by the tiles in a rule and its ancestors -
 * the same collection the editor uses for `availableOutputKeys` gating.
 */
function collectAvailableOutputKeys(rule: IBrainRuleDef): UniqueSet<string> {
  const keys = new UniqueSet<string>();
  let current: IBrainRuleDef | undefined = rule;
  while (current) {
    for (const side of [current.when(), current.do()]) {
      const tiles = side.tiles();
      for (let i = 0; i < tiles.size(); i++) {
        const provided = tiles.get(i).providedOutputs();
        for (let j = 0; j < provided.size(); j++) {
          keys.add(provided.get(j));
        }
      }
    }
    current = current.ancestor();
  }
  return keys;
}

/** Builds a fresh single-rule brain and places `sensor` on the rule's when(). */
function ruleWithSensor(environment: MindcraftEnvironment, sensor: IBrainTileDef): IBrainRuleDef {
  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "gating brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensor);
  return rule;
}

/**
 * Asserts, for the rule's available output keys, that each `(tile, offered)` pair
 * matches the gate the editor applies: an output tile is offered iff its
 * `outputKey` is among the keys provided in the rule hierarchy.
 */
function assertOffered(rule: IBrainRuleDef, expectations: readonly [BrainTileOutputDef, boolean][]): void {
  const keys = collectAvailableOutputKeys(rule);
  for (const [tile, offered] of expectations) {
    assert.equal(
      keys.has(tile.outputKey),
      offered,
      `${tile.tileId} (${tile.outputKey}) should be ${offered ? "offered" : "hidden"}`
    );
  }
}

test("radio output tiles gate by identity and do not cross-gate with another provider", () => {
  const environment = createMicroBitV2Environment();
  const user = installUserSensor(environment);

  const numberSensor = getTile(environment, mkSensorTileId(MicroBitV2HostActions.RadioReceiveNumber.key));
  const stringSensor = getTile(environment, mkSensorTileId(MicroBitV2HostActions.RadioReceiveString.key));
  const bufferSensor = getTile(environment, mkSensorTileId(MicroBitV2HostActions.RadioReceiveBuffer.key));

  const valueNumber = getOutputTile(environment, CoreTypeIds.Number, "value");
  const valueString = getOutputTile(environment, CoreTypeIds.String, "value");
  const valueBuffer = getOutputTile(environment, CoreTypeIds.Buffer, "value");
  const rssi = getOutputTile(environment, CoreTypeIds.Number, "rssi");

  // Downstream of `radio receive number`: its own value + the shared signal
  // strength surface; the other typed values, and the unrelated user output,
  // stay hidden.
  assertOffered(ruleWithSensor(environment, numberSensor), [
    [valueNumber, true],
    [rssi, true],
    [valueString, false],
    [valueBuffer, false],
    [user.output, false],
  ]);

  // Downstream of `radio receive string`: its own value + the shared signal
  // strength surface; the other typed values and the user output stay hidden.
  // The shared rssi identity surfacing here as well as above is the intended
  // sharing.
  assertOffered(ruleWithSensor(environment, stringSensor), [
    [valueString, true],
    [rssi, true],
    [valueNumber, false],
    [valueBuffer, false],
    [user.output, false],
  ]);

  // Downstream of `radio receive buffer`: its Buffer-typed value + the shared
  // signal strength surface; the other typed values and the user output stay
  // hidden.
  assertOffered(ruleWithSensor(environment, bufferSensor), [
    [valueBuffer, true],
    [rssi, true],
    [valueNumber, false],
    [valueString, false],
    [user.output, false],
  ]);

  // Downstream of the user sensor: only its own output surfaces; none of the
  // radio output tiles cross-gate from an unrelated provider's key.
  assertOffered(ruleWithSensor(environment, user.sensor), [
    [user.output, true],
    [valueNumber, false],
    [valueString, false],
    [valueBuffer, false],
    [rssi, false],
  ]);
});
