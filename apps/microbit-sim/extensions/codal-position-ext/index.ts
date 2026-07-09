import { NumberType, type StructOf, StructType } from "mindcraft";

/**
 * A two-axis position value in game convention: `x` is the horizontal axis
 * (right positive), `y` the vertical axis (up positive), both centered and
 * normalized to -100..100.
 *
 * As a `StructType` it is a first-class tile type: a tile may declare it as a
 * `returnType` and take it as a typed argument, `accessors: true` derives the
 * `[x]` / `[y]` read tiles, and `variables: true` offers a "create variable of
 * type position" factory tile. Import it as the extension's published surface
 * from `@ext/mindcraft-lang/codal-position-ext`.
 */
export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
  variables: true,
});

/** A position value: `{ x, y }` in game convention, both -100..100. */
export type Position = StructOf<typeof Position>;
