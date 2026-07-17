import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { buildMicrobitBrainEditorConfig, createMicrobitTileVisualResolver } from "./editor-config";
import { tileVisuals } from "./tile-visuals";

/**
 * Tile kinds whose display label derives from the tile's own data (literal
 * value, variable name, accessor field name, output name, page name) rather
 * than from the tile id.
 */
const DATA_LABELED_KINDS = new Set<string>(["literal", "variable", "accessor", "output", "page"]);

/**
 * Every catalog tile of the shipped microbit-v2 environment that the tile
 * picker can offer. Hidden and deprecated tiles are excluded, matching the
 * suggestion engine's filtering.
 */
function visibleCatalogTiles(): IBrainTileDef[] {
  const env = createMicroBitV2Environment();
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

/** Absolute on-disk path of an app-served icon URL (a root-absolute `/assets/...` path). */
function iconFilePath(iconUrl: string): string {
  return fileURLToPath(new URL(`../../public${iconUrl}`, import.meta.url));
}

describe("microbit-sim tile visuals", () => {
  test("every visible catalog tile resolves an explicit label instead of the id-derived fallback", () => {
    const resolveTileVisual = createMicrobitTileVisualResolver((url) => url);
    const offenders: string[] = [];
    for (const tileDef of visibleCatalogTiles()) {
      if (DATA_LABELED_KINDS.has(tileDef.kind)) {
        continue;
      }
      const appLabel = resolveTileVisual(tileDef)?.label;
      const intrinsicLabel = tileDef.metadata?.label;
      if (!appLabel && !intrinsicLabel) {
        offenders.push(tileDef.tileId);
      }
    }
    assert.deepEqual(offenders, [], `tiles without an explicit label: ${offenders.join(", ")}`);
  });

  test("every visible catalog tile resolves an icon instead of the missing-tile fallback", () => {
    const resolveTileVisual = createMicrobitTileVisualResolver((url) => url);
    const offenders: string[] = [];
    for (const tileDef of visibleCatalogTiles()) {
      const iconUrl = resolveTileVisual(tileDef)?.iconUrl ?? tileDef.metadata?.iconUrl;
      if (!iconUrl) {
        offenders.push(tileDef.tileId);
      }
    }
    assert.deepEqual(offenders, [], `tiles without an icon: ${offenders.join(", ")}`);
  });

  test("every tile-visuals map entry targets a shipped catalog tile and carries an icon", () => {
    const shippedTileIds = new Set(visibleCatalogTiles().map((tileDef) => tileDef.tileId));
    const staleKeys: string[] = [];
    const iconless: string[] = [];
    for (const [tileId, visual] of tileVisuals) {
      if (!shippedTileIds.has(tileId)) {
        staleKeys.push(tileId);
      }
      if (!visual.iconUrl) {
        iconless.push(tileId);
      }
    }
    assert.deepEqual(staleKeys, [], `map keys without a shipped catalog tile: ${staleKeys.join(", ")}`);
    assert.deepEqual(iconless, [], `map entries without an icon: ${iconless.join(", ")}`);
  });

  test("every mapped tile and data-type icon URL points at an svg that exists on disk", () => {
    const iconUrls = new Set<string>();
    for (const visual of tileVisuals.values()) {
      if (visual.iconUrl) {
        iconUrls.add(visual.iconUrl);
      }
    }
    const config = buildMicrobitBrainEditorConfig(createMicroBitV2Environment(), (url) => url, undefined);
    for (const iconUrl of config.dataTypeIcons.values()) {
      iconUrls.add(iconUrl);
    }
    const missing = [...iconUrls].filter((iconUrl) => !existsSync(iconFilePath(iconUrl)));
    assert.deepEqual(missing, [], `icon URLs without a backing file: ${missing.join(", ")}`);
  });
});
