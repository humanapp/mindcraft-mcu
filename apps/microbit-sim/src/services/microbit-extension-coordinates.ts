import type { StdlibImportRedirect } from "@mindcraft-lang/bridge-app";

/**
 * The core layer's `<owner>/<repo>` coordinate: its identity, its compiler
 * namespace, and the name it is imported and stored under
 * (`@ext/mindcraft-lang/core`). A present-but-empty placeholder for future
 * core-general imported helpers, at the base of the stack.
 */
export const CORE_LIB_COORDINATE = "mindcraft-lang/core";

/** Manifest reference form delivering the core layer from the app bundle. */
export const CORE_LIB_REFERENCE = "embedded:mindcraft-lang/core";

/**
 * The wodal-general layer's `<owner>/<repo>` coordinate: its identity, its
 * compiler namespace, and the name it is imported and stored under
 * (`@ext/mindcraft-lang/wodal`). A present-but-empty placeholder for future
 * wodal-general imported helpers; depends on the core layer.
 */
export const WODAL_LIB_COORDINATE = "mindcraft-lang/wodal";

/** Manifest reference form delivering the wodal-general layer from the app bundle. */
export const WODAL_LIB_REFERENCE = "embedded:mindcraft-lang/wodal";

/**
 * The micro:bit v2 layer's `<owner>/<repo>` coordinate: its identity, its
 * compiler namespace, and the name it is imported and stored under
 * (`@ext/mindcraft-lang/microbit-v2`). Carries the micro:bit LED-display image
 * builders and glyph helpers; depends on the wodal layer.
 */
export const MICROBIT_V2_LIB_COORDINATE = "mindcraft-lang/microbit-v2";

/** Manifest reference form delivering the micro:bit v2 layer from the app bundle. */
export const MICROBIT_V2_LIB_REFERENCE = "embedded:mindcraft-lang/microbit-v2";

/**
 * Extensions seeded into every new microbit-sim project's manifest, keyed by
 * coordinate. Seeding the micro:bit v2 layer alone is enough: its bundled
 * `mindcraft.json` declares the edge to the wodal layer, which in turn declares
 * the edge to the core layer, so transitive resolution pulls all three into the
 * project.
 */
export const microbitDefaultExtensions: Readonly<Record<string, string>> = {
  [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
};

/**
 * Redirects carrying a project onto the micro:bit v2 layer's final
 * `mindcraft-lang/microbit-v2` coordinate, the layer the image builders now
 * live on. Legacy `stdlib/image` imports, the interim `@ext/wodal-stdlib` entry
 * import, and the prior wodal-layer entry `@ext/mindcraft-lang/wodal` all
 * rewrite to `@ext/mindcraft-lang/microbit-v2`; the prior `wodal-stdlib` and
 * `mindcraft-lang/wodal` manifest keys are removed as the coordinate is
 * backfilled; and saved-brain symbol origins on any prior form
 * (`embedded:wodal-stdlib`, the transport-prefixed `gh:mindcraft-lang/wodal`,
 * or the bare `mindcraft-lang/wodal`) are rewritten to the bare
 * `mindcraft-lang/microbit-v2` coordinate.
 *
 * The `gh:mindcraft-lang/wodal` origin precedes the bare `mindcraft-lang/wodal`
 * origin so the transport-prefixed form is rewritten whole before the bare
 * substring inside it is matched.
 */
export const microbitStdlibImportRedirects: readonly StdlibImportRedirect[] = [
  {
    fromSpecifiers: ["stdlib", "@ext/wodal-stdlib", "@ext/mindcraft-lang/wodal"],
    toCoordinate: MICROBIT_V2_LIB_COORDINATE,
    toReference: MICROBIT_V2_LIB_REFERENCE,
    interimManifestKeys: ["wodal-stdlib", WODAL_LIB_COORDINATE],
    interimOrigins: ["embedded:wodal-stdlib", "gh:mindcraft-lang/wodal", WODAL_LIB_COORDINATE],
    toOrigin: MICROBIT_V2_LIB_COORDINATE,
  },
];
