import type { EmbeddedExtension, StdlibImportRedirect } from "@mindcraft-lang/bridge-app";
import wodalStdlibImage from "@mindcraft-lang/wodal/lib/image.ts?raw";
import wodalStdlibEntry from "@mindcraft-lang/wodal/lib/index.ts?raw";

/**
 * The Wodal standard library's `<owner>/<repo>` coordinate: its identity, its
 * compiler namespace, and the name it is imported and stored under
 * (`@ext/mindcraft-lang/wodal-lib`).
 */
export const WODAL_LIB_COORDINATE = "mindcraft-lang/wodal-lib";

/** Manifest reference form delivering the Wodal standard library from the app bundle. */
export const WODAL_LIB_REFERENCE = "embedded:wodal-lib";

/**
 * The Wodal standard library as a default embedded extension: image builders
 * and glyph helpers, sourced from the wodal package and identified by its
 * canonical `mindcraft-lang/wodal-lib` coordinate.
 */
export const wodalStdlibExtension: EmbeddedExtension = {
  canonicalOrigin: WODAL_LIB_COORDINATE,
  files: [
    { path: "index.ts", content: wodalStdlibEntry },
    { path: "image.ts", content: wodalStdlibImage },
  ],
};

/** Extensions bundled with microbit-sim, resolved from `embedded:<repo>` references. */
export const microbitEmbeddedExtensions: readonly EmbeddedExtension[] = [wodalStdlibExtension];

/** Extensions seeded into every new microbit-sim project's manifest, keyed by coordinate. */
export const microbitDefaultExtensions: Readonly<Record<string, string>> = {
  [WODAL_LIB_COORDINATE]: WODAL_LIB_REFERENCE,
};

/**
 * Redirects carrying a project onto the Wodal standard library's final
 * `mindcraft-lang/wodal-lib` coordinate. Legacy `stdlib/image` imports and the
 * interim `@ext/wodal-stdlib` entry import both rewrite to
 * `@ext/mindcraft-lang/wodal-lib`; the interim `wodal-stdlib` manifest key is
 * removed as the coordinate is backfilled; and saved-brain symbol origins on
 * either prior form (`embedded:wodal-stdlib`, or a `gh:mindcraft-lang/wodal-lib`
 * transport-prefixed form) are rewritten to the bare `mindcraft-lang/wodal-lib`
 * coordinate.
 */
export const microbitStdlibImportRedirects: readonly StdlibImportRedirect[] = [
  {
    fromSpecifiers: ["stdlib", "@ext/wodal-stdlib"],
    toCoordinate: WODAL_LIB_COORDINATE,
    toReference: WODAL_LIB_REFERENCE,
    interimManifestKeys: ["wodal-stdlib"],
    interimOrigins: ["embedded:wodal-stdlib", "gh:mindcraft-lang/wodal-lib"],
    toOrigin: WODAL_LIB_COORDINATE,
  },
];
