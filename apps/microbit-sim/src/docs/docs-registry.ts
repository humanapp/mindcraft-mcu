import type { UserTileMetadata } from "@mindcraft-lang/bridge-app";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import type { DocsRegistry, DocsTileEntry } from "@mindcraft-lang/docs";
import { buildDocsRegistry } from "@mindcraft-lang/docs";
import { patternContent } from "./_generated/en";
import {
  patternDocs,
  tileCategoryOverrides,
  tileDocContent,
  tileKindCategories,
  undocumentedTileIds,
} from "./manifest";

/** Maps compiled user-tile metadata to docs entries keyed by tile id. */
function buildUserTileDocEntries(metadata: readonly UserTileMetadata[]): DocsTileEntry[] {
  const entries: DocsTileEntry[] = [];
  for (const entry of metadata) {
    const tileId = entry.kind === "sensor" ? mkSensorTileId(entry.key) : mkActuatorTileId(entry.key);
    entries.push({
      tileId,
      tags: entry.tags ? [...entry.tags] : [],
      category: entry.kind === "sensor" ? "Sensors" : "Actuators",
      content: entry.docsMarkdown ?? "",
    });
  }
  return entries;
}

/**
 * Derives docs entries for the visible host catalog tiles. Skips hidden and
 * deprecated tiles, tiles for which `isDocumented` reports an existing entry,
 * curated exclusions, and tiles of kinds without a docs category.
 */
function buildHostTileDocEntries(catalog: ITileCatalog, isDocumented: (tileId: string) => boolean): DocsTileEntry[] {
  const entries: DocsTileEntry[] = [];
  const all = catalog.getAll();
  for (let i = 0; i < all.size(); i++) {
    const tileDef = all.get(i)!;
    if (tileDef.hidden || tileDef.deprecated) {
      continue;
    }
    if (isDocumented(tileDef.tileId) || undocumentedTileIds.has(tileDef.tileId)) {
      continue;
    }
    const category = tileCategoryOverrides[tileDef.tileId] ?? tileKindCategories[tileDef.kind];
    if (!category) {
      continue;
    }
    entries.push({
      tileId: tileDef.tileId,
      tags: [],
      category,
      content: tileDocContent[tileDef.tileId] ?? "",
    });
  }
  return entries;
}

/**
 * Builds the docs registry for the micro:bit simulator: the core docs, the
 * app's pattern pages, entries derived from the environment's visible host
 * catalog tiles, and entries for the project's compiled user tiles. Host
 * tiles without markdown content yet register with empty content and render
 * the sidebar's no-documentation fallback.
 */
export function createMicrobitDocsRegistry(
  env: MindcraftEnvironment,
  userTileMetadata: readonly UserTileMetadata[] | undefined
): DocsRegistry {
  const registry = buildDocsRegistry({
    appPatterns: { meta: patternDocs, content: patternContent },
  });
  const hostTileEntries = buildHostTileDocEntries(env.brainServices.edit.tiles, (tileId) => registry.tiles.has(tileId));
  if (hostTileEntries.length > 0) {
    registry.register({ tiles: hostTileEntries });
  }
  const userTileEntries = buildUserTileDocEntries(userTileMetadata ?? []);
  if (userTileEntries.length > 0) {
    registry.register({ tiles: userTileEntries });
  }
  return registry;
}

/** Tile catalog that resolves a tile id across every catalog the environment registers. */
export function createDocsTileCatalog(env: MindcraftEnvironment): ITileCatalog {
  return {
    get: (tileId: string) => {
      for (const catalog of env.tileCatalogs()) {
        const def = catalog.get(tileId);
        if (def) {
          return def;
        }
      }
      return undefined;
    },
  } as ITileCatalog;
}
