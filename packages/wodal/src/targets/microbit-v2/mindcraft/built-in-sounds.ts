import {
  List,
  mkClosedStructValue,
  mkLiteralTileId,
  mkStringValue,
  mkTypeId,
  NativeType,
  type StructValue,
  type Value,
} from "@mindcraft-lang/core/app";

/** TypeId of the `SoundEmoji` value struct the built-in sound literals carry. */
export const SOUND_EMOJI_TYPE_ID = mkTypeId(NativeType.Struct, "SoundEmoji");

/**
 * Numeric field ids and storage slots for the `SoundEmoji` value struct. Each
 * value is the field's durable id and slot; baked `SoundEmoji` literals store
 * their fields in this slot order.
 */
export enum SoundEmojiField {
  Name = 0,
}

/**
 * A built-in micro:bit sound emoji: a name (the durable literal-tile
 * discriminator, and the key the speaker port resolves), a display label, and
 * the sound's nominal total duration in milliseconds.
 */
export interface BuiltInSoundDef {
  /** Durable value label; also the literal tile id discriminator. */
  readonly name: string;

  /** Human-readable tile label. */
  readonly label: string;

  /**
   * Nominal total duration in milliseconds: the sum of the sound's encoded
   * CODAL segment durations with every randomized contribution read as zero.
   * The speaker lease runs for exactly this long.
   */
  readonly durationMs: number;
}

/**
 * The micro:bit-v2 built-in sound emoji set, the 10 CODAL sounds. Append-only:
 * add new sounds at the end and never rename or repurpose an existing entry,
 * since a brain references a built-in literal by its derived id (see
 * {@link builtInSoundTileId}). `hello` is the target's default sound, played
 * when `play sound` is called without a sound argument. Each duration is the
 * nominal total derived from the sound's encoded segments in the vendored
 * CODAL source (codal-microbit-v2 `SoundExpressions.cpp`); the C++ VM carries
 * the identical table in `cpp/targets/microbit-v2/abi/sound-emoji.h`.
 */
export const BUILT_IN_SOUNDS: readonly BuiltInSoundDef[] = [
  { name: "giggle", label: "giggle", durationMs: 1491 },
  { name: "happy", label: "happy", durationMs: 1259 },
  { name: "hello", label: "hello", durationMs: 506 },
  { name: "mysterious", label: "mysterious", durationMs: 4181 },
  { name: "sad", label: "sad", durationMs: 1644 },
  { name: "slide", label: "slide", durationMs: 1133 },
  { name: "soaring", label: "soaring", durationMs: 8039 },
  { name: "spring", label: "spring", durationMs: 2326 },
  { name: "twinkle", label: "twinkle", durationMs: 6722 },
  { name: "yawn", label: "yawn", durationMs: 2812 },
];

/** The name of the built-in played when `play sound` omits its sound argument. */
export const DEFAULT_BUILT_IN_SOUND_NAME = "hello";

/**
 * Looks up a built-in sound by name. Returns undefined for a name outside the
 * built-in set; the speaker port treats such a play as a silent no-op.
 */
export function findBuiltInSound(name: string): BuiltInSoundDef | undefined {
  return BUILT_IN_SOUNDS.find((sound) => sound.name === name);
}

/**
 * The baked `SoundEmoji` struct value of a built-in: `{ name }`. This is the
 * value a surface-1 built-in literal tile carries and bakes into a program.
 */
export function builtInSoundStructValue(def: BuiltInSoundDef): StructValue {
  const slots: Value[] = [];
  slots[SoundEmojiField.Name] = mkStringValue(def.name);
  return mkClosedStructValue(SOUND_EMOJI_TYPE_ID, List.from(slots));
}

/** The derived literal tile id of a built-in sound's surface-1 tile. */
export function builtInSoundTileId(def: BuiltInSoundDef): string {
  return mkLiteralTileId(SOUND_EMOJI_TYPE_ID, def.name);
}
