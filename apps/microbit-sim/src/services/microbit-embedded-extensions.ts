import embeddedExtensionBundles from "virtual:mindcraft-embedded-extensions";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";

export {
  CODAL_LIB_COORDINATE,
  CODAL_LIB_REFERENCE,
  CODAL_POSITION_EXT_COORDINATE,
  CODAL_POSITION_EXT_REFERENCE,
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  microbitDefaultExtensions,
} from "./microbit-extension-coordinates";

/**
 * Extensions bundled with microbit-sim, resolved from `embedded:<owner>/<repo>`
 * references. Each bundle is assembled at build time from its own extension's
 * `mindcraft.json` `files` list; the app registers coordinates in its Vite
 * config and never enumerates an extension's files. The layer stack is
 * core <- wodal <- microbit-v2; seeding the micro:bit v2 layer alone resolves
 * all three layers transitively through their bundled `mindcraft.json` edges.
 * The Position add-on is an installable-on-demand entry and is not seeded by
 * default.
 */
export const microbitEmbeddedExtensions: readonly EmbeddedExtension[] = embeddedExtensionBundles;
