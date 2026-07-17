import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BrainTileModifierDef, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { createMicrobitDocsRegistry } from "./docs-registry";
import { tileCategoryOverrides, tileDocContent, tileKindCategories, undocumentedTileIds } from "./manifest";

/**
 * Tile kinds with no docs entry of their own. Output tiles expose fields of a
 * sensor's result and are documented by that sensor's page.
 */
const EXCLUDED_KINDS = new Set<string>(["output"]);

/**
 * Individual tiles with no docs entry of their own. The parenthesis tiles are
 * expression punctuation, and the boolean/nil value literals are covered by
 * the Literals concept page that the sidebar redirects literal tiles to.
 */
const EXCLUDED_TILE_IDS = [
  "tile.cf->open-paren",
  "tile.cf->close-paren",
  "tile.literal->boolean:<boolean>->true",
  "tile.literal->boolean:<boolean>->false",
  "tile.literal->nil:<nil>->nil",
];

/**
 * Every catalog tile of the given environment that the tile picker can offer.
 * Hidden and deprecated tiles are excluded, matching the suggestion engine's
 * filtering.
 */
function visibleCatalogTiles(env: MindcraftEnvironment): IBrainTileDef[] {
  const tiles: IBrainTileDef[] = [];
  for (const catalog of env.tileCatalogs()) {
    const all = catalog.getAll();
    for (let i = 0; i < all.size(); i++) {
      const tileDef = all.get(i)!;
      if (tileDef.hidden || tileDef.deprecated) {
        continue;
      }
      tiles.push(tileDef);
    }
  }
  return tiles;
}

describe("microbit-sim docs registry", () => {
  test("the visible catalog tiles without a docs entry are exactly the stated exclusions", () => {
    const env = createMicroBitV2Environment();
    const registry = createMicrobitDocsRegistry(env, []);
    const undocumented = visibleCatalogTiles(env)
      .filter((tileDef) => !EXCLUDED_KINDS.has(tileDef.kind))
      .filter((tileDef) => !registry.tiles.has(tileDef.tileId))
      .map((tileDef) => tileDef.tileId)
      .sort();
    assert.deepEqual(undocumented, [...EXCLUDED_TILE_IDS].sort());
  });

  test("every curation entry targets a shipped visible catalog tile", () => {
    const env = createMicroBitV2Environment();
    const shippedTileIds = new Set(visibleCatalogTiles(env).map((tileDef) => tileDef.tileId));
    const curatedTileIds = [
      ...undocumentedTileIds,
      ...Object.keys(tileCategoryOverrides),
      ...Object.keys(tileDocContent),
    ];
    const stale = curatedTileIds.filter((tileId) => !shippedTileIds.has(tileId));
    assert.deepEqual(stale, [], `curation entries without a shipped catalog tile: ${stale.join(", ")}`);
  });

  test("a tile added to the host catalog gets a docs entry with a kind-derived category", () => {
    const env = createMicroBitV2Environment();
    const added = new BrainTileModifierDef("microbit-v2.docs-spec-added");
    env.brainServices.edit.tiles.add(added);
    const registry = createMicrobitDocsRegistry(env, []);
    const entry = registry.tiles.get(added.tileId);
    assert.ok(entry, "the added catalog tile should get a derived docs entry");
    assert.equal(entry.category, tileKindCategories.modifier);
  });
});
