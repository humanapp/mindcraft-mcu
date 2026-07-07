import type { EmbeddedExtension, StdlibImportRedirect } from "@mindcraft-lang/bridge-app";
import { embeddedOrigin } from "@mindcraft-lang/bridge-app";
import wodalStdlibImage from "@mindcraft-lang/wodal/stdlib/image.ts?raw";
import wodalStdlibEntry from "@mindcraft-lang/wodal/stdlib/index.ts?raw";

/** Slug the Wodal standard library extension is addressed by (`@ext/wodal-stdlib`). */
export const WODAL_STDLIB_SLUG = "wodal-stdlib";

/**
 * The Wodal standard library as a default embedded extension: image builders
 * and glyph helpers, sourced from the wodal package.
 */
export const wodalStdlibExtension: EmbeddedExtension = {
  slug: WODAL_STDLIB_SLUG,
  canonicalOrigin: embeddedOrigin(WODAL_STDLIB_SLUG),
  files: [
    { path: "index.ts", content: wodalStdlibEntry },
    { path: "image.ts", content: wodalStdlibImage },
  ],
};

/** Extensions bundled with microbit-sim, resolved from `embedded:<slug>` references. */
export const microbitEmbeddedExtensions: readonly EmbeddedExtension[] = [wodalStdlibExtension];

/** Extensions seeded into every new microbit-sim project's manifest. */
export const microbitDefaultExtensions: Readonly<Record<string, string>> = {
  [WODAL_STDLIB_SLUG]: `embedded:${WODAL_STDLIB_SLUG}`,
};

/**
 * Redirects that rewrite legacy `stdlib/image` imports to the `@ext/wodal-stdlib`
 * entry surface and backfill the `wodal-stdlib` dependency into the manifest.
 */
export const microbitStdlibImportRedirects: readonly StdlibImportRedirect[] = [
  {
    fromPrefix: "stdlib",
    toSlug: WODAL_STDLIB_SLUG,
    backfillSlug: WODAL_STDLIB_SLUG,
    backfillReference: `embedded:${WODAL_STDLIB_SLUG}`,
  },
];
