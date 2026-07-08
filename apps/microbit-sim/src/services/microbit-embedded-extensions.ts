import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import coreLibAmbient from "@mindcraft-lang/core/ambient/mindcraft.core.d.ts?raw";
import coreLibEntry from "@mindcraft-lang/core/lib/index.ts?raw";
import coreLibManifest from "@mindcraft-lang/core/lib/mindcraft.json?raw";
import microbitV2LibAmbient from "@mindcraft-lang/wodal/ambient/mindcraft.microbit-v2.d.ts?raw";
import wodalLibAmbient from "@mindcraft-lang/wodal/ambient/mindcraft.wodal.d.ts?raw";
import wodalLibEntry from "@mindcraft-lang/wodal/lib/index.ts?raw";
import wodalLibManifest from "@mindcraft-lang/wodal/lib/mindcraft.json?raw";
import microbitV2LibImage from "@mindcraft-lang/wodal/targets/microbit-v2/lib/image.ts?raw";
import microbitV2LibEntry from "@mindcraft-lang/wodal/targets/microbit-v2/lib/index.ts?raw";
import microbitV2LibManifest from "@mindcraft-lang/wodal/targets/microbit-v2/lib/mindcraft.json?raw";
import {
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  WODAL_LIB_COORDINATE,
} from "./microbit-extension-coordinates";

export {
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  microbitDefaultExtensions,
  WODAL_LIB_COORDINATE,
  WODAL_LIB_REFERENCE,
} from "./microbit-extension-coordinates";

/**
 * The micro:bit v2 layer as an embedded extension: the micro:bit LED-display
 * image builders and glyph helpers plus the target's ambient `.d.ts`
 * (`MicroBit`, `MicroBitDisplay`, `Context`), identified by the canonical
 * `mindcraft-lang/microbit-v2` coordinate. Its bundled `mindcraft.json`
 * declares the ambient file and the edge down to the wodal layer.
 */
export const microbitV2StdlibExtension: EmbeddedExtension = {
  canonicalOrigin: MICROBIT_V2_LIB_COORDINATE,
  files: [
    { path: "index.ts", content: microbitV2LibEntry },
    { path: "image.ts", content: microbitV2LibImage },
    { path: "mindcraft.microbit-v2.d.ts", content: microbitV2LibAmbient },
    { path: "mindcraft.json", content: microbitV2LibManifest },
  ],
};

/**
 * The wodal-general layer as an embedded extension: the wodal-general device
 * ambient `.d.ts` (`Image`, `Button`, `Accelerometer`, and the rest) over an
 * empty entry placeholder, identified by the canonical `mindcraft-lang/wodal`
 * coordinate. Its bundled `mindcraft.json` declares the ambient file and the
 * edge down to the core layer.
 */
export const wodalStdlibExtension: EmbeddedExtension = {
  canonicalOrigin: WODAL_LIB_COORDINATE,
  files: [
    { path: "index.ts", content: wodalLibEntry },
    { path: "mindcraft.wodal.d.ts", content: wodalLibAmbient },
    { path: "mindcraft.json", content: wodalLibManifest },
  ],
};

/**
 * The core layer as an embedded extension: the core language-global and base
 * `"mindcraft"` ambient `.d.ts` over an empty entry placeholder, identified by
 * the canonical `mindcraft-lang/core` coordinate, at the base of the stack with
 * no further dependencies. Its bundled `mindcraft.json` declares the ambient
 * file.
 */
export const coreStdlibExtension: EmbeddedExtension = {
  canonicalOrigin: CORE_LIB_COORDINATE,
  files: [
    { path: "index.ts", content: coreLibEntry },
    { path: "mindcraft.core.d.ts", content: coreLibAmbient },
    { path: "mindcraft.json", content: coreLibManifest },
  ],
};

/**
 * Extensions bundled with microbit-sim, resolved from `embedded:<owner>/<repo>`
 * references. The stack is core <- wodal <- microbit-v2; seeding the micro:bit
 * v2 layer alone resolves all three transitively through their bundled
 * `mindcraft.json` edges.
 */
export const microbitEmbeddedExtensions: readonly EmbeddedExtension[] = [
  microbitV2StdlibExtension,
  wodalStdlibExtension,
  coreStdlibExtension,
];
