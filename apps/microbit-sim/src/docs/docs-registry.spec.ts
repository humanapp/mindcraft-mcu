import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { BrainTileModifierDef, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { conceptContent, patternContent, tileContent } from "./_generated/en";
import { createMicrobitDocsRegistry } from "./docs-registry";
import {
  conceptOrder,
  patternDocs,
  tileCategoryOverrides,
  tileDocContent,
  tileKindCategories,
  undocumentedTileIds,
} from "./manifest";

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
 * Core-owned docs entries whose markdown body is missing upstream: the core
 * manifest registers these tile ids but ships no content for their content
 * keys. Shrink-only; content for them belongs in the core docs package.
 */
const CORE_ENTRIES_WITHOUT_CONTENT = [
  "tile.var.factory->boolean",
  "tile.var.factory->number",
  "tile.var.factory->string",
  "tile.lit.factory->number",
  "tile.lit.factory->string",
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

  test("every visible catalog tile resolves docs content or is a declared exclusion", () => {
    const env = createMicroBitV2Environment();
    const registry = createMicrobitDocsRegistry(env, []);
    const contentless = visibleCatalogTiles(env)
      .filter((tileDef) => !EXCLUDED_KINDS.has(tileDef.kind))
      .map((tileDef) => tileDef.tileId)
      .filter((tileId) => (registry.tiles.get(tileId)?.content ?? "").trim() === "")
      .sort();
    assert.deepEqual(contentless, [...EXCLUDED_TILE_IDS, ...CORE_ENTRIES_WITHOUT_CONTENT].sort());
  });

  test("the generated content module matches the markdown files on disk", () => {
    const readContentDir = (subdir: string): Record<string, string> => {
      const contentDir = fileURLToPath(new URL(`./content/en/${subdir}`, import.meta.url));
      const fromDisk: Record<string, string> = {};
      for (const file of fs.readdirSync(contentDir).sort()) {
        if (!file.endsWith(".md")) {
          continue;
        }
        fromDisk[file.slice(0, -3)] = fs.readFileSync(path.join(contentDir, file), "utf-8");
      }
      return fromDisk;
    };
    assert.deepEqual(
      tileContent,
      readContentDir("tiles"),
      "run `npm run generate:docs` after editing content/en/tiles"
    );
    assert.deepEqual(
      patternContent,
      readContentDir("patterns"),
      "run `npm run generate:docs` after editing content/en/patterns"
    );
    assert.deepEqual(
      conceptContent,
      readContentDir("concepts"),
      "run `npm run generate:docs` after editing content/en/concepts"
    );
  });

  test("every concept in conceptOrder registers under the concepts category", () => {
    const env = createMicroBitV2Environment();
    const registry = createMicrobitDocsRegistry(env, []);
    for (const id of conceptOrder) {
      const entry = registry.concepts.get(id);
      assert.ok(entry, `concept '${id}' should register`);
      assert.equal(entry.id, id);
    }
  });

  test("every pattern doc entry registers with non-empty content", () => {
    const env = createMicroBitV2Environment();
    const registry = createMicrobitDocsRegistry(env, []);
    for (const meta of patternDocs) {
      const entry = registry.patterns.get(meta.id);
      assert.ok(entry, `pattern '${meta.id}' should register`);
      assert.notEqual(entry.content.trim(), "", `pattern '${meta.id}' should resolve markdown content`);
    }
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
