import { NumberType, type StructOf, StructType } from "mindcraft";

/**
 * Stick position in game convention: `x` is the horizontal axis (right
 * positive), `y` the vertical axis (up positive), both centered and normalized
 * to -100..100. Declared once and referenced by both the stick sensor's and the
 * decoder's return types so producers and consumers speak one type. Being a
 * `StructType` makes `position` a first-class tile type: tiles may declare it as
 * a `returnType` and take it as a typed argument, `accessors: true` derives the
 * `[x]` / `[y]` read tiles, and `variables: true` offers a "create variable of
 * type position" factory tile.
 */
export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: NumberType },
  accessors: true,
  variables: true,
});

/** A position value: `{ x, y }` in game convention, both -100..100. */
export type Position = StructOf<typeof Position>;
