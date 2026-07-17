// ---------------------------------------------------------------------------
// App-specific documentation curation. Host tile docs entries are derived
// from the environment's tile catalog at registry-build time; these maps hold
// the hand-curated exceptions and the markdown content, keyed by tile id.
// ---------------------------------------------------------------------------

import type { BrainTileKind } from "@mindcraft-lang/core/app";

/**
 * Docs sidebar category for each tile kind that gets a derived docs entry.
 * Visible catalog tiles of kinds absent here get no entry.
 */
export const tileKindCategories: Partial<Record<BrainTileKind, string>> = {
  sensor: "Sensors",
  actuator: "Actuators",
  modifier: "Parameters & Modifiers",
  parameter: "Parameters & Modifiers",
  literal: "Literals",
};

/**
 * Visible catalog tiles deliberately left without a docs entry. The boolean
 * and nil value literals are covered by the core Literals concept page.
 */
export const undocumentedTileIds: ReadonlySet<string> = new Set([
  "tile.literal->boolean:<boolean>->true",
  "tile.literal->boolean:<boolean>->false",
  "tile.literal->nil:<nil>->nil",
]);

/**
 * Docs sidebar category overrides, keyed by tile id, for tiles whose
 * kind-derived category is wrong.
 */
export const tileCategoryOverrides: Readonly<Record<string, string>> = {};

/**
 * Markdown documentation bodies keyed by tile id. Tiles without a body render
 * the sidebar's no-documentation fallback.
 */
export const tileDocContent: Readonly<Record<string, string>> = {};
