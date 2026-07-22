import type { UserTileMetadata } from "@mindcraft-lang/bridge-app";
import type { ActionKind, MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { mkActionTileId } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import type { DocsRegistry, DocsTileEntry } from "@mindcraft-lang/docs";
import { buildDocsRegistry } from "@mindcraft-lang/docs";
import { conceptContent, patternContent } from "./_generated/en";
import {
  conceptOrder,
  conceptTags,
  conceptTitles,
  patternDocs,
  tileCategoryOverrides,
  tileDocContent,
  tileKindCategories,
  undocumentedTileIds,
} from "./manifest";

/** Docs category label for each tile-bearing user-action kind. */
const kUserTileDocCategories: Record<Exclude<ActionKind, "conversion">, string> = {
  sensor: "Sensors",
  actuator: "Actuators",
};

/** Maps compiled user-tile metadata to docs entries keyed by tile id. */
function buildUserTileDocEntries(metadata: readonly UserTileMetadata[]): DocsTileEntry[] {
  const entries: DocsTileEntry[] = [];
  for (const entry of metadata) {
    entries.push({
      tileId: mkActionTileId(entry.kind, entry.key),
      tags: entry.tags ? [...entry.tags] : [],
      category: kUserTileDocCategories[entry.kind],
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
 * app's pattern and concept pages, entries derived from the environment's
 * visible host catalog tiles, and entries for the project's compiled user
 * tiles. Host tiles without markdown content yet register with empty content
 * and render the sidebar's no-documentation fallback.
 */
export function createMicrobitDocsRegistry(
  env: MindcraftEnvironment,
  userTileMetadata: readonly UserTileMetadata[] | undefined
): DocsRegistry {
  const registry = buildDocsRegistry({
    appPatterns: { meta: patternDocs, content: patternContent },
  });
  const orderedConcepts = conceptOrder
    .filter((id) => id in conceptContent)
    .concat(Object.keys(conceptContent).filter((id) => !conceptOrder.includes(id)));
  registry.register({
    concepts: orderedConcepts.map((id) => ({
      id,
      title: conceptTitles[id] ?? id,
      tags: conceptTags[id] ?? [],
      content: conceptContent[id],
    })),
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
