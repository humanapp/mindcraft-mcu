export { CORE_LIB_COORDINATE, CORE_LIB_REFERENCE } from "@mindcraft-lang/bridge-app";

/**
 * The wodal-general layer's `<owner>/<repo>` coordinate: its identity, its
 * compiler namespace, and the name it is imported and stored under
 * (`@lib/mindcraft-lang/lib-codal`). A present-but-empty placeholder for future
 * wodal-general imported helpers; depends on the core layer.
 */
export const CODAL_LIB_COORDINATE = "mindcraft-lang/lib-codal";

/** Manifest reference form delivering the wodal-general layer from the app bundle. */
export const CODAL_LIB_REFERENCE = "embedded:mindcraft-lang/lib-codal";

/**
 * The micro:bit v2 standard-library layer's `<owner>/<repo>` coordinate: its
 * identity, its compiler namespace, and the name it is imported and stored under
 * (`@lib/mindcraft-lang/lib-microbit-v2`). Carries the micro:bit LED-display image
 * builders and glyph helpers; depends on the wodal layer. This is the layer a
 * user library targets and the compatibility filter reads.
 */
export const MICROBIT_V2_LIB_COORDINATE = "mindcraft-lang/lib-microbit-v2";

/** Manifest reference form delivering the micro:bit v2 standard-library layer from the app bundle. */
export const MICROBIT_V2_LIB_REFERENCE = "embedded:mindcraft-lang/lib-microbit-v2";

/**
 * The micro:bit v2 editor/hostApp target's `<owner>/<repo>` coordinate: the
 * runnable platform a project references. It carries no standard-library code;
 * its manifest declares an embedded dependency on {@link
 * MICROBIT_V2_LIB_COORDINATE}, so the standard library resolves transitively
 * into a project's stack.
 */
export const MICROBIT_V2_TARGET_COORDINATE = "mindcraft-lang/trg-microbit-v2";

/** Manifest reference form delivering the micro:bit v2 target from the app bundle. */
export const MICROBIT_V2_TARGET_REFERENCE = "embedded:mindcraft-lang/trg-microbit-v2";

/**
 * Coordinate of the Position add-on: an installable capability extension
 * publishing the `position` struct type for WODAL-based targets. It is a
 * published (`gh:`) library fetched at install time; a bundled catalog move
 * redirects dependents' embedded references to its pinned `gh:` reference.
 * Opaque `<owner>/<repo>` identity; the repo segment is human-readable and never
 * parsed by code.
 */
export const CODAL_POSITION_EXT_COORDINATE = "mindcraft-lang/lib-codal-position";

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
 * coordinate. Seeding the micro:bit v2 target alone is enough: its bundled
 * `mindcraft.json` declares the edge to the standard-library layer, which
 * declares the edge to the wodal layer, which declares the edge to the core
 * layer, so transitive resolution pulls the target and all three layers into the
 * project.
 */
export const microbitDefaultExtensions: Readonly<Record<string, string>> = {
  [MICROBIT_V2_TARGET_COORDINATE]: MICROBIT_V2_TARGET_REFERENCE,
};
