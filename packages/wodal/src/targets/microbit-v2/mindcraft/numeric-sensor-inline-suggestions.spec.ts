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
import { List } from "@mindcraft-lang/core";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { type IBrainTileDef, mkOperatorTileId, RuleSide, TilePlacement } from "@mindcraft-lang/core/brain";
import { parseTilesForSuggestions, suggestTiles } from "@mindcraft-lang/core/brain/language-service";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { CoreOpId, CoreTypeIds, mkSensorTileId } from "@mindcraft-lang/core/runtime";
import { createMicroBitV2Environment } from "./environment";
import { MicroBitV2HostActions } from "./tile-ids";

/** Fetch a registered sensor tile by its host-action key. */
function sensorTile(environment: MindcraftEnvironment, key: string): IBrainTileDef {
  const tile = environment.brainServices.edit.tiles.get(mkSensorTileId(key));
  assert.ok(tile, `sensor tile '${key}' must be registered`);
  return tile;
}

/** Suggestions offered after the tiles form a complete expression on the WHEN side. */
function suggestionsAfter(environment: MindcraftEnvironment, tiles: readonly IBrainTileDef[]) {
  const services = environment.brainServices;
  const expr = parseTilesForSuggestions(List.from<IBrainTileDef>(tiles));
  return suggestTiles({ ruleSide: RuleSide.When, expr }, List.from([services.edit.tiles]), services);
}

/** Whether the greater-than operator tile is among the offered suggestions. */
function offersGreaterThan(environment: MindcraftEnvironment, sensorKey: string): boolean {
  const suggestions = suggestionsAfter(environment, [sensorTile(environment, sensorKey)]);
  const gtId = mkOperatorTileId(CoreOpId.GreaterThan);
  const has = (list: typeof suggestions.exact) => list.toArray().some((s) => s.tileDef.tileId === gtId);
  return has(suggestions.exact) || has(suggestions.withConversion);
}

/** Count of operator tiles among the offered suggestions. */
function offeredOperatorCount(environment: MindcraftEnvironment, sensorKey: string): number {
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
    when.appendTile(sensorTile(environment, MicroBitV2HostActions.LightLevel.key));
    when.appendTile(services.edit.tiles.get(mkOperatorTileId(CoreOpId.GreaterThan))!);
    when.appendTile(new BrainTileLiteralDef(CoreTypeIds.Number, 50, {}, services));

    const brain = environment.createBrain(environment.deserializeBrainJson(brainDef.toJson()));
    assert.equal(brain.status, "active", "the composed numeric comparison must build");
  });

  test("the non-inline gesture sensor offers no trailing operator and keeps WHEN-side placement", () => {
    const environment = createMicroBitV2Environment();
    assert.equal(offeredOperatorCount(environment, MicroBitV2HostActions.Gesture.key), 0);
    const placement = sensorTile(environment, MicroBitV2HostActions.Gesture.key).placement;
    assert.equal(placement !== undefined && (placement & TilePlacement.Inline) !== 0, false);
  });
});
