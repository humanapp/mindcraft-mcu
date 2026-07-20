// ---------------------------------------------------------------------------
// App-specific documentation curation. Host tile docs entries are derived
// from the environment's tile catalog at registry-build time; these maps hold
// the hand-curated exceptions, the pattern page metadata, and the markdown
// content, keyed by tile id or content key. Content bodies live as .md files
// under content/en/tiles/ and content/en/patterns/ and reach this module
// through the generated locale module (npm run generate:docs).
// ---------------------------------------------------------------------------

import type { BrainTileKind } from "@mindcraft-lang/core/app";
import type { AppPatternDocMeta } from "@mindcraft-lang/docs";
import { tileContent } from "./_generated/en";

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
 * Pattern doc pages. Each entry's `contentKey` is a filename stem under
 * content/en/patterns/.
 */
export const patternDocs: readonly AppPatternDocMeta[] = [
  {
    id: "button-press-response",
    title: "Respond to a Button Press",
    tags: ["buttons", "display", "basics"],
    category: "Basics",
    contentKey: "button-press-response",
  },
];

/**
 * Content key (a filename stem under content/en/tiles/) for each documented
 * host tile, keyed by tile id.
 */
const tileContentKeys: Readonly<Record<string, string>> = {
  "tile.sensor->microbit-v2.button-a": "sensor-button-a",
  "tile.sensor->microbit-v2.button-b": "sensor-button-b",
  "tile.sensor->microbit-v2.button-ab": "sensor-button-ab",
  "tile.sensor->microbit-v2.button-logo": "sensor-logo",
  "tile.sensor->microbit-v2.gesture": "sensor-gesture",
  "tile.sensor->microbit-v2.radio-receive-number": "sensor-radio-receive-number",
  "tile.sensor->microbit-v2.radio-receive-string": "sensor-radio-receive-string",
  "tile.sensor->microbit-v2.radio-receive-buffer": "sensor-radio-receive-buffer",
  "tile.actuator->microbit-v2.radio-send": "actuator-radio-send",
  "tile.actuator->microbit-v2.set-radio-group": "actuator-set-radio-group",
  "tile.actuator->microbit-v2.display-set-pixel": "actuator-set-pixel",
  "tile.actuator->microbit-v2.display-scroll": "actuator-display-text",
  "tile.actuator->microbit-v2.draw-image": "actuator-draw-image",
  "tile.actuator->microbit-v2.play-sound": "actuator-play-sound",
  "tile.modifier->microbit-v2.pressed": "modifier-pressed",
  "tile.modifier->microbit-v2.released": "modifier-released",
  "tile.modifier->microbit-v2.click": "modifier-click",
  "tile.modifier->microbit-v2.double-click": "modifier-double-click",
  "tile.modifier->microbit-v2.long-click": "modifier-long-click",
  "tile.modifier->microbit-v2.held": "modifier-held",
  "tile.modifier->microbit-v2.shake": "modifier-shake",
  "tile.modifier->microbit-v2.tilt-up": "modifier-tilt-up",
  "tile.modifier->microbit-v2.tilt-down": "modifier-tilt-down",
  "tile.modifier->microbit-v2.tilt-left": "modifier-tilt-left",
  "tile.modifier->microbit-v2.tilt-right": "modifier-tilt-right",
  "tile.modifier->microbit-v2.face-up": "modifier-face-up",
  "tile.modifier->microbit-v2.face-down": "modifier-face-down",
  "tile.modifier->microbit-v2.freefall": "modifier-freefall",
  "tile.modifier->microbit-v2.immediately": "modifier-immediately",
  "tile.modifier->microbit-v2.in-background": "modifier-in-background",
  "tile.parameter->microbit-v2.x": "parameter-x",
  "tile.parameter->microbit-v2.y": "parameter-y",
  "tile.parameter->microbit-v2.brightness": "parameter-brightness",
  "tile.parameter->microbit-v2.text": "parameter-text",
  "tile.parameter->microbit-v2.image": "parameter-image",
  "tile.parameter->microbit-v2.duration": "parameter-duration",
  "tile.parameter->microbit-v2.sound-emoji": "parameter-sound",
  "tile.literal->struct:<Image>->heart": "literal-image-heart",
  "tile.literal->struct:<Image>->happy": "literal-image-happy",
  "tile.literal->struct:<Image>->sad": "literal-image-sad",
  "tile.literal->struct:<Image>->arrow-north": "literal-image-arrow-north",
  "tile.literal->struct:<Image>->arrow-south": "literal-image-arrow-south",
  "tile.literal->struct:<Image>->arrow-east": "literal-image-arrow-east",
  "tile.literal->struct:<Image>->arrow-west": "literal-image-arrow-west",
  "tile.literal->struct:<SoundEmoji>->giggle": "literal-sound-giggle",
  "tile.literal->struct:<SoundEmoji>->happy": "literal-sound-happy",
  "tile.literal->struct:<SoundEmoji>->hello": "literal-sound-hello",
  "tile.literal->struct:<SoundEmoji>->mysterious": "literal-sound-mysterious",
  "tile.literal->struct:<SoundEmoji>->sad": "literal-sound-sad",
  "tile.literal->struct:<SoundEmoji>->slide": "literal-sound-slide",
  "tile.literal->struct:<SoundEmoji>->soaring": "literal-sound-soaring",
  "tile.literal->struct:<SoundEmoji>->spring": "literal-sound-spring",
  "tile.literal->struct:<SoundEmoji>->twinkle": "literal-sound-twinkle",
  "tile.literal->struct:<SoundEmoji>->yawn": "literal-sound-yawn",
};

/**
 * Markdown documentation bodies keyed by tile id. Tiles without a body render
 * the sidebar's no-documentation fallback.
 */
export const tileDocContent: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(tileContentKeys).map(([tileId, contentKey]) => [tileId, tileContent[contentKey] ?? ""])
);
