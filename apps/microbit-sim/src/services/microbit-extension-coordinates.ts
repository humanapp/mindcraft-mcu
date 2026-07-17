export { CORE_LIB_COORDINATE, CORE_LIB_REFERENCE } from "@mindcraft-lang/bridge-app";

/**
 * The wodal-general layer's `<owner>/<repo>` coordinate: its identity, its
 * compiler namespace, and the name it is imported and stored under
 * (`@lib/mindcraft-lang/codal`). A present-but-empty placeholder for future
 * wodal-general imported helpers; depends on the core layer.
 */
export const CODAL_LIB_COORDINATE = "mindcraft-lang/codal";

/** Manifest reference form delivering the wodal-general layer from the app bundle. */
export const CODAL_LIB_REFERENCE = "embedded:mindcraft-lang/codal";

/**
 * The micro:bit v2 layer's `<owner>/<repo>` coordinate: its identity, its
 * compiler namespace, and the name it is imported and stored under
 * (`@lib/mindcraft-lang/microbit-v2`). Carries the micro:bit LED-display image
 * builders and glyph helpers; depends on the wodal layer.
 */
export const MICROBIT_V2_LIB_COORDINATE = "mindcraft-lang/microbit-v2";

/** Manifest reference form delivering the micro:bit v2 layer from the app bundle. */
export const MICROBIT_V2_LIB_REFERENCE = "embedded:mindcraft-lang/microbit-v2";

/**
 * Coordinate of the Position add-on: an installable capability extension
 * publishing the `position` struct type for WODAL-based targets. Opaque
 * `<owner>/<repo>` identity; the repo segment is human-readable and never parsed
 * by code.
 */
export const CODAL_POSITION_EXT_COORDINATE = "mindcraft-lang/lib-codal-position";

/** Manifest reference form delivering the Position add-on from the app bundle. */
export const CODAL_POSITION_EXT_REFERENCE = "embedded:mindcraft-lang/lib-codal-position";

/**
 * Coordinate of the Cutebot chassis add-on: an installable capability extension
 * whose movement and line-sensor tiles target the micro:bit v2 layer. Opaque
 * `<owner>/<repo>` identity; the repo segment is human-readable and never parsed
 * by code.
 */
export const CUTEBOT_EXT_COORDINATE = "mindcraft-lang/lib-microbit-cutebot";

/** Manifest reference form delivering the Cutebot add-on from the app bundle. */
export const CUTEBOT_EXT_REFERENCE = "embedded:mindcraft-lang/lib-microbit-cutebot";

/**
 * Coordinate of the Yahboom gamepad add-on: an installable capability extension
 * whose stick, button, and packet-decode tiles target the micro:bit v2 layer and
 * depend on the Position add-on for their struct type.
 */
export const YAHBOOM_GAMEPAD_EXT_COORDINATE = "mindcraft-lang/lib-microbit-yahboom-gamepad";

/** Manifest reference form delivering the Yahboom gamepad add-on from the app bundle. */
export const YAHBOOM_GAMEPAD_EXT_REFERENCE = "embedded:mindcraft-lang/lib-microbit-yahboom-gamepad";

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
