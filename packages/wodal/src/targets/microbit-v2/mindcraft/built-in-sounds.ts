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

  /**
   * The sound's CODAL sound-expression data, vendored verbatim from
   * codal-microbit-v2 `SoundExpressions.cpp`: comma-separated 72-character
   * zero-padded decimal segments. Decode it with `decodeSoundExpression` (or
   * `decodeBuiltInSound`) to drive the simulator's Web Audio renderer.
   */
  readonly encoded: string;
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
  {
    name: "giggle",
    label: "giggle",
    durationMs: 1491,
    encoded:
      "010230988019008440044008881023001601003300240000000000000000000000000000,110232570087411440044008880352005901003300010000000000000000010000000000,310232729021105440288908880091006300000000240700020000000000003000000000,310232729010205440288908880091006300000000240700020000000000003000000000,310232729011405440288908880091006300000000240700020000000000003000000000",
  },
  {
    name: "happy",
    label: "happy",
    durationMs: 1259,
    encoded:
      "010231992066911440044008880262002800001800020500000000000000010000000000,002322129029508440240408880000000400022400110000000000000000007500000000,000002129029509440240408880145000400022400110000000000000000007500000000",
  },
  {
    name: "hello",
    label: "hello",
    durationMs: 506,
    encoded:
      "310230673019702440118708881023012800000000240000000000000000000000000000,300001064001602440098108880000012800000100040000000000000000000000000000,310231064029302440098108881023012800000100040000000000000000000000000000",
  },
  {
    name: "mysterious",
    label: "mysterious",
    durationMs: 4181,
    encoded:
      "400002390033100440240408880477000400022400110400000000000000008000000000,405512845385000440044008880000012803010500160000000000000000085000500015",
  },
  {
    name: "sad",
    label: "sad",
    durationMs: 1644,
    encoded:
      "310232226070801440162408881023012800000100240000000000000000000000000000,310231623093602440093908880000012800000100240000000000000000000000000000",
  },
  {
    name: "slide",
    label: "slide",
    durationMs: 1133,
    encoded:
      "105202325022302440240408881023012801020000110400000000000000010000000000,010232520091002440044008881023012801022400110400000000000000010000000000",
  },
  {
    name: "soaring",
    label: "soaring",
    durationMs: 8039,
    encoded:
      "210234009530905440599908881023002202000400020250000000000000020000000000,402233727273014440044008880000003101024400030000000000000000000000000000",
  },
  {
    name: "spring",
    label: "spring",
    durationMs: 2326,
    encoded:
      "306590037116312440058708880807003400000000240000000000000000050000000000,010230037116313440058708881023003100000000240000000000000000050000000000",
  },
  {
    name: "twinkle",
    label: "twinkle",
    durationMs: 6722,
    encoded: "010180007672209440075608880855012800000000240000000000000000000000000000",
  },
  {
    name: "yawn",
    label: "yawn",
    durationMs: 2812,
    encoded:
      "200002281133202440150008881023012801024100240400030000000000010000000000,005312520091002440044008880636012801022400110300000000000000010000000000,008220784019008440044008880681001600005500240000000000000000005000000000,004790784019008440044008880298001600000000240000000000000000005000000000,003210784019008440044008880108001600003300080000000000000000005000000000",
  },
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
