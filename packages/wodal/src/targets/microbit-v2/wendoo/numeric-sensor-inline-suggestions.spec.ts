/**
 * Picker probe for the numeric micro:bit value sensors (light level,
 * temperature). Both are inline Number sensors, so a complete `[light level]`
 * (or `[temperature]`) is a value expression the picker continues with numeric
 * infix operators, and `[light level] [>] [50]` links into an active brain. The
 * non-inline gesture sensor is the control: completing it offers no trailing
 * operator, and its tile keeps WHEN-side-only placement. This pins the fix for
 * the playtest report that a placed light-level tile suggested no next tiles.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { List } from "@wendoo/core";
import type { WendooEnvironment } from "@wendoo/core/app";
import { type IBrainTileDef, mkOperatorTileId, RuleSide, TilePlacement } from "@wendoo/core/brain";
import { parseTilesForSuggestions, suggestTiles } from "@wendoo/core/brain/language-service";
import { BrainDef } from "@wendoo/core/brain/model";
import { CoreOpId, CoreTypeIds, mkSensorTileId } from "@wendoo/core/runtime";
import { createMicroBitV2Environment } from "./environment";
import { MicroBitV2HostActions } from "./tile-ids";

/** Fetch a registered sensor tile by its host-action key. */
function sensorTile(environment: WendooEnvironment, key: string): IBrainTileDef {
  const tile = environment.brainServices.edit.tiles.get(mkSensorTileId(key));
  assert.ok(tile, `sensor tile '${key}' must be registered`);
  return tile;
}

/** Suggestions offered after the tiles form a complete expression on the WHEN side. */
function suggestionsAfter(environment: WendooEnvironment, tiles: readonly IBrainTileDef[]) {
  const services = environment.brainServices;
  const expr = parseTilesForSuggestions(List.from<IBrainTileDef>(tiles));
  return suggestTiles({ ruleSide: RuleSide.When, expr }, List.from([services.edit.tiles]), services);
}

/** Whether the greater-than operator tile is among the offered suggestions. */
function offersGreaterThan(environment: WendooEnvironment, sensorKey: string): boolean {
  const suggestions = suggestionsAfter(environment, [sensorTile(environment, sensorKey)]);
  const gtId = mkOperatorTileId(CoreOpId.GreaterThan);
  const has = (list: typeof suggestions.exact) => list.toArray().some((s) => s.tileDef.tileId === gtId);
  return has(suggestions.exact) || has(suggestions.withConversion);
}

/** Count of operator tiles among the offered suggestions. */
function offeredOperatorCount(environment: WendooEnvironment, sensorKey: string): number {
  const suggestions = suggestionsAfter(environment, [sensorTile(environment, sensorKey)]);
  const count = (list: typeof suggestions.exact) => list.toArray().filter((s) => s.tileDef.kind === "operator").length;
  return count(suggestions.exact) + count(suggestions.withConversion);
}

describe("numeric micro:bit sensors are inline and compose with operators", () => {
  test("a complete light-level sensor offers numeric infix operators", () => {
    const environment = createMicroBitV2Environment();
    assert.equal(offersGreaterThan(environment, MicroBitV2HostActions.LightLevel.key), true);
    assert.ok(offeredOperatorCount(environment, MicroBitV2HostActions.LightLevel.key) > 0);
  });

  test("a complete temperature sensor offers numeric infix operators", () => {
    const environment = createMicroBitV2Environment();
    assert.equal(offersGreaterThan(environment, MicroBitV2HostActions.Temperature.key), true);
    assert.ok(offeredOperatorCount(environment, MicroBitV2HostActions.Temperature.key) > 0);
  });

  test("the light-level tile carries the inline placement bit", () => {
    const environment = createMicroBitV2Environment();
    const placement = sensorTile(environment, MicroBitV2HostActions.LightLevel.key).placement;
    assert.ok(placement !== undefined);
    assert.equal((placement & TilePlacement.Inline) !== 0, true, "light-level must be inline-placeable");
  });

  test("[light level] [>] [50] links into an active brain", () => {
    const environment = createMicroBitV2Environment();
    const services = environment.brainServices;
    const brainDef = BrainDef.emptyBrainDef(services, "inline light-level compare");
    const when = brainDef.pages().get(0)!.children().get(0)!.when();
    const sensor = sensorTile(environment, MicroBitV2HostActions.LightLevel.key);
    const greaterThan = services.edit.tiles.get(mkOperatorTileId(CoreOpId.GreaterThan))!;
    const fifty = services.edit.tileBuilder.createLiteralTileDef(brainDef.catalog(), CoreTypeIds.Number, 50, {});
    when.appendTile(sensor);
    when.appendTile(greaterThan);
    when.appendTile(fifty);

    const reloaded = environment.deserializeBrainJson(brainDef.toJson());
    const reloadedWhen = reloaded.pages().get(0)!.children().get(0)!.when().tiles();
    assert.deepEqual(
      reloadedWhen.toArray().map((tileDef) => tileDef.tileId),
      [sensor.tileId, greaterThan.tileId, fifty.tileId],
      "every composed tile must survive the brain JSON round trip"
    );

    const brain = environment.createBrain(reloaded);
    assert.equal(brain.status, "active", "the composed numeric comparison must build");
  });

  test("the non-inline gesture sensor offers no trailing operator and keeps WHEN-side placement", () => {
    const environment = createMicroBitV2Environment();
    assert.equal(offeredOperatorCount(environment, MicroBitV2HostActions.Gesture.key), 0);
    const placement = sensorTile(environment, MicroBitV2HostActions.Gesture.key).placement;
    assert.equal(placement !== undefined && (placement & TilePlacement.Inline) !== 0, false);
  });
});
