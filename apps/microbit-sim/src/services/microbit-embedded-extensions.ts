import embeddedExtensionBundles from "virtual:wendoo-embedded-extensions";
import type { EmbeddedExtension } from "@wendoo-lang/bridge-app";

export {
  CODAL_LIB_COORDINATE,
  CODAL_LIB_REFERENCE,
  CODAL_POSITION_EXT_COORDINATE,
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  MICROBIT_V2_TARGET_COORDINATE,
  MICROBIT_V2_TARGET_REFERENCE,
  microbitDefaultExtensions,
} from "./microbit-extension-coordinates";

/**
 * Extensions bundled with microbit-sim, resolved from `embedded:<owner>/<repo>`
 * references. Each bundle is assembled at build time from its own extension's
 * `wendoo.json` `files` list; the app registers coordinates in its Vite
 * config and never enumerates an extension's files. The layer stack is
 * core <- wodal <- microbit-v2; seeding the micro:bit v2 target alone resolves
 * the target and all three layers transitively through their bundled
 * `wendoo.json` edges. Feature libraries are not bundled: the catalog offers
 * them at pinned `gh:` references and they are fetched at install time.
 */
export const microbitEmbeddedExtensions: readonly EmbeddedExtension[] = embeddedExtensionBundles;
