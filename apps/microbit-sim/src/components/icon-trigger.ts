/**
 * Tailwind classes for a bare glyph-only trigger button -- the `...` overflow
 * menus and the pencil beside them -- that is not built on the shared `Button`
 * primitive.
 *
 * Draws a 24x24 target on a fine pointer; the shared coarse-pointer floor in
 * `packages/ui/src/ui.css` takes it to 44x44 on touch. Append per-site classes
 * (disabled styling, for instance) after it.
 */
export const kIconTriggerClasses =
  "inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground";
