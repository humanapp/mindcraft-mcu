import { CoreTypeIds, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { type BrainEditorConfig, staticAssetUrl, type TileVisual } from "@mindcraft-lang/ui";

const ICON_BASE = staticAssetUrl("assets/brain/icons");

/**
 * Returns a tile-visual resolver that rewrites compiler-minted `/vfs/<path>`
 * tile icon URLs to loadable URLs via `resolveVfsAssetUrl`. Tiles without a
 * VFS icon URL resolve to undefined and keep their intrinsic visuals.
 */
export function createMicrobitTileVisualResolver(
  resolveVfsAssetUrl: (url: string) => string
): (tileDef: IBrainTileDef) => TileVisual | undefined {
  return (tileDef) => {
    const intrinsic = tileDef.metadata as TileVisual | undefined;
    if (!intrinsic?.iconUrl) {
      return undefined;
    }
    const resolved = resolveVfsAssetUrl(intrinsic.iconUrl);
    return resolved === intrinsic.iconUrl ? undefined : { ...intrinsic, iconUrl: resolved };
  };
}

/**
 * Builds the microbit-v2 brain editor config from the app environment.
 *
 * Tile and data-type icon URLs point at `public/assets/brain/icons`. Missing
 * art resolves to the bundled `question_mark.svg` missing-tile fallback until
 * the real SVGs are supplied. Host tiles registered by the microbit-v2 module
 * appear automatically through `tileCatalogs`. Compiler-minted `/vfs/<path>`
 * tile icons resolve to loadable URLs through `resolveVfsAssetUrl`.
 */
export function buildMicrobitBrainEditorConfig(
  env: MindcraftEnvironment,
  resolveVfsAssetUrl: (url: string) => string,
  projectNamespace: string | undefined,
  onTileHelp?: BrainEditorConfig["onTileHelp"],
  docsIntegration?: BrainEditorConfig["docsIntegration"]
): BrainEditorConfig {
  return {
    projectNamespace,
    onTileHelp,
    docsIntegration,
    dataTypeIcons: new Map([
      [CoreTypeIds.Boolean, `${ICON_BASE}/boolean.svg`],
      [CoreTypeIds.Number, `${ICON_BASE}/number.svg`],
      [CoreTypeIds.String, `${ICON_BASE}/text.svg`],
    ]),
    dataTypeNames: new Map([
      [CoreTypeIds.Boolean, "boolean"],
      [CoreTypeIds.Number, "number"],
      [CoreTypeIds.String, "text"],
    ]),
    customLiteralTypes: [],
    brainServices: env.brainServices,
    tileCatalogs: env.tileCatalogs(),
    resolveTileVisual: createMicrobitTileVisualResolver(resolveVfsAssetUrl),
  };
}
