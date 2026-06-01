import { CoreTypeIds, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { BrainEditorConfig } from "@mindcraft-lang/ui";

const ICON_BASE = "/assets/brain/icons";

/**
 * Builds the microbit-v2 brain editor config from the app environment.
 *
 * Tile and data-type icon URLs point at `public/assets/brain/icons`. Missing
 * art resolves to the bundled `question_mark.svg` missing-tile fallback until
 * the real SVGs are supplied. Host tiles registered by the microbit-v2 module
 * appear automatically through `tileCatalogs`.
 */
export function buildMicrobitBrainEditorConfig(env: MindcraftEnvironment): BrainEditorConfig {
  return {
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
  };
}
