/**
 * Tailwind classes for a bare glyph-only trigger button -- the `...` overflow
 * menus and the pencil beside them -- that is not built on the shared `Button`
 * primitive.
 *
 * Draws a 24x24 target on a fine pointer and at least 44x44 under
 * `@media (pointer: coarse)`. Append per-site classes (disabled styling, for
 * instance) after it.
 */
export const kIconTriggerClasses =
  "inline-flex items-center justify-center rounded p-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-muted-foreground hover:bg-muted hover:text-foreground";
