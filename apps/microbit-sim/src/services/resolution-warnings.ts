import type { ExtensionResolutionWarning } from "@wendoo/bridge-app";

/**
 * The warning kinds reporting a library whose content did not resolve on the
 * last load or install: a catalog move that could not be applied, or a
 * declared target with no content. A brain tile from such a library loads as a
 * missing-tile placeholder until the library resolves.
 */
const UNRESOLVED_LIBRARY_WARNING_KINDS: ReadonlySet<ExtensionResolutionWarning["kind"]> = new Set([
  "catalog-move-failed",
  "unresolved-target",
]);

/**
 * The `<owner>/<repo>` coordinates of the libraries the given resolution
 * warnings report as unresolved, unique, in encounter order. Warnings of
 * advisory kinds contribute no coordinates.
 *
 * @param warnings - The active project's latest resolution warnings.
 */
export function unresolvedLibraryCoordinates(warnings: readonly ExtensionResolutionWarning[]): string[] {
  const coordinates: string[] = [];
  const seen = new Set<string>();
  for (const warning of warnings) {
    if (UNRESOLVED_LIBRARY_WARNING_KINDS.has(warning.kind) && !seen.has(warning.origin)) {
      seen.add(warning.origin);
      coordinates.push(warning.origin);
    }
  }
  return coordinates;
}
