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
