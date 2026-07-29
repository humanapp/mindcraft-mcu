import { assertUnreachable } from "@mindcraft-lang/core";
import { CoreTypeIds, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { BrainTileKind, IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainEditorConfig, TileVisual } from "@mindcraft-lang/ui";
import { ICON_BASE, tileVisuals } from "./tile-visuals";

/** The default icon URL a tile of the given kind falls back to, or undefined when the kind has no kind-specific default. */
function defaultKindIconUrl(kind: BrainTileKind): string | undefined {
  switch (kind) {
    case "page":
      return `${ICON_BASE}/page3.svg`;
    case "undefined":
    case "sensor":
    case "actuator":
    case "parameter":
    case "operator":
    case "variable":
    case "literal":
    case "factory":
    case "controlFlow":
    case "modifier":
    case "accessor":
    case "output":
    case "missing":
      return undefined;
    default:
      return assertUnreachable(kind);
  }
}

/**
 * Returns a tile-visual resolver that supplies the app's mapped visuals for
 * core tiles (see `tileVisuals`), gives page tiles the shared page icon when
 * they carry none of their own, and rewrites compiler-minted `/vfs/<path>`
 * tile icon URLs to loadable URLs via `resolveVfsAssetUrl`. Tiles with no
 * map entry, page icon, or VFS icon URL resolve to undefined and keep their
 * intrinsic visuals.
 */
export function createMicrobitTileVisualResolver(
  resolveVfsAssetUrl: (url: string) => string
): (tileDef: IBrainTileDef) => TileVisual | undefined {
  return (tileDef) => {
    const mapped = tileVisuals.get(tileDef.tileId);
    const intrinsic = tileDef.metadata as TileVisual | undefined;
    const intrinsicIconUrl = intrinsic?.iconUrl;
    const resolvedIconUrl = intrinsicIconUrl ? resolveVfsAssetUrl(intrinsicIconUrl) : undefined;
    const rewrittenIconUrl = resolvedIconUrl !== intrinsicIconUrl ? resolvedIconUrl : undefined;
    const defaultIconUrl = !mapped?.iconUrl && !intrinsicIconUrl ? defaultKindIconUrl(tileDef.kind) : undefined;
    if (!mapped && rewrittenIconUrl === undefined && defaultIconUrl === undefined) {
      return undefined;
    }
    const visual: Partial<TileVisual> = {
      ...(intrinsic ?? {}),
      ...(mapped ?? {}),
      ...(rewrittenIconUrl !== undefined ? { iconUrl: rewrittenIconUrl } : {}),
      ...(defaultIconUrl !== undefined ? { iconUrl: defaultIconUrl } : {}),
    };
    return visual as TileVisual;
  };
}

/** Data-type icon URLs keyed by type id, shared by the brain editor and the docs surfaces. */
export const microbitDataTypeIcons: ReadonlyMap<string, string> = new Map([
  [CoreTypeIds.Boolean, `${ICON_BASE}/boolean.svg`],
  [CoreTypeIds.Number, `${ICON_BASE}/number.svg`],
  [CoreTypeIds.String, `${ICON_BASE}/text.svg`],
]);

/** Friendly data-type names keyed by type id, shared by the brain editor and the docs surfaces. */
export const microbitDataTypeNames: ReadonlyMap<string, string> = new Map([
  [CoreTypeIds.Boolean, "boolean"],
  [CoreTypeIds.Number, "number"],
  [CoreTypeIds.String, "text"],
]);

/**
 * Builds the microbit-v2 brain editor config from the app environment.
 *
 * Tile and data-type icon URLs point at `public/assets/brain/icons`. A tile
 * with no mapped or intrinsic icon resolves to the bundled `question_mark.svg`
 * missing-tile fallback. Host tiles registered by the microbit-v2 module
 * appear automatically through `tileCatalogs`. Compiler-minted `/vfs/<path>`
 * tile icons resolve to loadable URLs through `resolveVfsAssetUrl`. When
 * `isBrokenTile` is supplied, the editor badges each instance of a user tile
 * whose definition failed to compile.
 */
export function buildMicrobitBrainEditorConfig(
  env: MindcraftEnvironment,
  resolveVfsAssetUrl: (url: string) => string,
  projectNamespace: string | undefined,
  onTileHelp?: BrainEditorConfig["onTileHelp"],
  docsIntegration?: BrainEditorConfig["docsIntegration"],
  libraries?: BrainEditorConfig["libraries"],
  printTransport?: BrainEditorConfig["printTransport"],
  isBrokenTile?: BrainEditorConfig["isBrokenTile"]
): BrainEditorConfig {
  return {
    projectNamespace,
    onTileHelp,
    docsIntegration,
    libraries,
    printTransport,
    isBrokenTile,
    dataTypeIcons: microbitDataTypeIcons,
    dataTypeNames: microbitDataTypeNames,
    customLiteralTypes: [],
    brainServices: env.brainServices,
    localizer: env.appServices.localizer,
    tileCatalogs: env.tileCatalogs(),
    resolveTileVisual: createMicrobitTileVisualResolver(resolveVfsAssetUrl),
  };
}
