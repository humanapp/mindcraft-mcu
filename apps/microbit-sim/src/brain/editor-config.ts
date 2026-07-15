import { CoreTypeIds, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { BrainEditorConfig, TileVisual } from "@mindcraft-lang/ui";

const ICON_BASE = "/assets/brain/icons";

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
  projectNamespace: string | undefined
): BrainEditorConfig {
  return {
    projectNamespace,
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
    resolveTileVisual: (tileDef) => {
      const intrinsic = tileDef.metadata as TileVisual | undefined;
      if (!intrinsic?.iconUrl) {
        return undefined;
      }
      const resolved = resolveVfsAssetUrl(intrinsic.iconUrl);
      return resolved === intrinsic.iconUrl ? undefined : { ...intrinsic, iconUrl: resolved };
    },
  };
}
