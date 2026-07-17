import type { UserTileMetadata } from "@mindcraft-lang/bridge-app";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { ITileCatalog } from "@mindcraft-lang/core/brain";
import type { DocsRegistry, DocsTileEntry } from "@mindcraft-lang/docs";
import { buildDocsRegistry } from "@mindcraft-lang/docs";

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
 * Builds the docs registry for the micro:bit simulator: the core docs plus
 * entries for the project's compiled user tiles.
 */
export function createMicrobitDocsRegistry(userTileMetadata: readonly UserTileMetadata[] | undefined): DocsRegistry {
  const registry = buildDocsRegistry();
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
