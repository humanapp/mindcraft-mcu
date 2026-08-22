import { BUILT_IN_SOUNDS, findBuiltInSound } from "./wendoo/built-in-sounds";

/** Oscillator waveform a decoded segment is synthesized with. */
export type SoundWaveform = "sine" | "sawtooth" | "triangle" | "square" | "noise";

/**
 * Frequency-interpolation shape of a decoded segment: how the pitch moves from
 * the segment's start frequency to its end frequency over the segment duration.
 *
 * - `none`: the pitch holds at the start frequency (no end frequency).
 * - `linear` / `curve` / `logarithmic` / `exponential-rising` /
 *   `exponential-falling`: the pitch sweeps from start to end frequency; the
 *   name is the CODAL interpolation curve.
 * - `arpeggio-ascending` / `arpeggio-descending`: CODAL steps through a musical
 *   progression with no swept end frequency. The renderer holds the start
 *   frequency for these (rendered as a no-op sweep).
 */
export type FrequencyInterpolationShape =
  | "none"
  | "linear"
  | "curve"
  | "logarithmic"
  | "exponential-rising"
  | "exponential-falling"
  | "arpeggio-ascending"
  | "arpeggio-descending";

/**
 * Modulation effect applied to a decoded segment, mapping CODAL's third
 * `SoundEffect` slot.
 *
 * - `none`: no modulation.
 * - `frequency-vibrato`: periodic pitch modulation.
 * - `volume-tremolo`: periodic volume modulation (CODAL's volume vibrato).
 * - `warble`: fast pitch warble between the start and end frequency.
 */
export type SoundEffectKind = "none" | "frequency-vibrato" | "volume-tremolo" | "warble";

/**
 * One decoded segment of a micro:bit sound expression: the renderable form of a
 * single CODAL `SoundEffect`. Frequencies are in Hz; volumes are on CODAL's
 * internal 0-1023 scale; the duration is in milliseconds. A sound is an ordered
 * list of these, played back to back for their durations.
 */
export interface DecodedSoundSegment {
  /** Oscillator waveform. */
  readonly waveform: SoundWaveform;

  /** Start frequency in Hz. */
  readonly startFrequency: number;

  /**
   * End frequency in Hz the pitch sweeps to over the duration. Equal to
   * {@link startFrequency} when {@link interpolation} is `none` or an arpeggio
   * shape (no swept end frequency).
   */
  readonly endFrequency: number;

  /** Frequency-interpolation shape from start to end frequency. */
  readonly interpolation: FrequencyInterpolationShape;

  /** Number of interpolation steps CODAL spreads the sweep across. */
  readonly interpolationSteps: number;

  /** Segment duration in milliseconds. */
  readonly durationMs: number;

  /** Start volume on CODAL's 0-1023 scale. */
  readonly startVolume: number;

  /** End volume on CODAL's 0-1023 scale; the volume ramps from start to end over the duration. */
  readonly endVolume: number;

  /** Modulation effect applied over the segment. */
  readonly effect: SoundEffectKind;

  /**
   * Effect parameter: for `frequency-vibrato` / `volume-tremolo` the CODAL
   * per-step multiplier; for `warble` the CODAL warble parameter. Zero when
   * {@link effect} is `none`.
   */
  readonly effectParam: number;

  /**
   * Number of effect steps spread across the duration (CODAL's
   * `duration / 10000 * fxnSteps`). Zero when {@link effect} is `none`.
   */
  readonly effectSteps: number;
}

/** Characters per CODAL sound-expression segment (excluding the comma separators). */
const CHARS_PER_SEGMENT = 72;

/** Reads a zero-padded decimal field of `digits` length starting at `offset`. Returns NaN on a non-digit. */
function parseField(segment: string, offset: number, digits: number): number {
  const slice = segment.slice(offset, offset + digits);
  if (!/^[0-9]+$/.test(slice)) {
    return Number.NaN;
  }
  return Number.parseInt(slice, 10);
}

/** Maps the CODAL wave field (0-4) to a waveform. */
function waveformFromField(wave: number): SoundWaveform {
  switch (wave) {
    case 0:
      return "sine";
    case 1:
      return "sawtooth";
    case 2:
      return "triangle";
    case 3:
      return "square";
    case 4:
      return "noise";
    default:
      return "sine";
  }
}

/** Maps the CODAL shape field to a frequency-interpolation shape. */
function interpolationFromShape(shape: number): FrequencyInterpolationShape {
  switch (shape) {
    case 1:
      return "linear";
    case 2:
      return "curve";
    case 5:
      return "exponential-rising";
    case 6:
      return "exponential-falling";
    case 18:
      return "logarithmic";
    case 8:
    case 10:
    case 12:
    case 14:
    case 16:
      return "arpeggio-ascending";
    case 9:
    case 11:
    case 13:
    case 15:
    case 17:
      return "arpeggio-descending";
    default:
      return "none";
  }
}

/** True when the shape carries a swept end frequency (CODAL sets `parameter[0]` = end frequency). */
function shapeHasEndFrequency(interpolation: FrequencyInterpolationShape): boolean {
  return (
    interpolation === "linear" ||
    interpolation === "curve" ||
    interpolation === "exponential-rising" ||
    interpolation === "exponential-falling" ||
    interpolation === "logarithmic"
  );
}

/** Maps the CODAL fx-choice field (0-3) to a modulation effect. */
function effectFromChoice(fxChoice: number): SoundEffectKind {
  switch (fxChoice) {
    case 1:
      return "frequency-vibrato";
    case 2:
      return "volume-tremolo";
    case 3:
      return "warble";
    default:
      return "none";
  }
}

/**
 * Decodes one 72-character CODAL sound-expression segment. Reads the field
 * layout of `SoundExpressions::parseSoundExpression`: wave, volume, frequency,
 * duration, shape, end frequency, end volume, steps, and the fx-choice /
 * fx-param / fx-steps effect fields. The randomization fields (offsets 44-71)
 * are read as zero, so the decode is deterministic.
 *
 * @param segment - A single 72-character segment.
 * @returns The decoded segment.
 * @throws If the segment is not 72 characters or contains a non-digit field.
 */
function decodeSegment(segment: string): DecodedSoundSegment {
  if (segment.length !== CHARS_PER_SEGMENT) {
    throw new Error(`sound-expression segment must be ${CHARS_PER_SEGMENT} chars, got ${segment.length}`);
  }
  const wave = parseField(segment, 0, 1);
  const volume = parseField(segment, 1, 4);
  const frequency = parseField(segment, 5, 4);
  const duration = parseField(segment, 9, 4);
  const shape = parseField(segment, 13, 2);
  const endFrequency = parseField(segment, 18, 4);
  const endVolume = parseField(segment, 26, 4);
  const steps = parseField(segment, 30, 4);
  const fxChoice = parseField(segment, 34, 2);
  const fxParam = parseField(segment, 36, 4);
  const fxnSteps = parseField(segment, 40, 4);

  const fields = [
    wave,
    volume,
    frequency,
    duration,
    shape,
    endFrequency,
    endVolume,
    steps,
    fxChoice,
    fxParam,
    fxnSteps,
  ];
  if (fields.some((value) => Number.isNaN(value))) {
    throw new Error(`sound-expression segment has a malformed field: "${segment}"`);
  }

  const interpolation = interpolationFromShape(shape);
  const effect = effectFromChoice(fxChoice);
  return {
    waveform: waveformFromField(wave),
    startFrequency: frequency,
    endFrequency: shapeHasEndFrequency(interpolation) ? endFrequency : frequency,
    interpolation,
    interpolationSteps: steps,
    durationMs: duration,
    startVolume: volume,
    endVolume,
    effect,
    effectParam: effect === "none" ? 0 : fxParam,
    // CODAL spreads the vibrato steps evenly across the segment duration.
    effectSteps: effect === "none" ? 0 : (duration / 10000) * fxnSteps,
  };
}

/**
 * Decodes a micro:bit sound-expression data string into its ordered segments.
 * The string is one or more 72-character segments joined by commas (CODAL's
 * built-in sound encoding). The decode is deterministic: every randomization
 * field reads as zero, so the segment durations sum to the sound's nominal
 * total duration.
 *
 * @param dataString - Comma-separated 72-character sound-expression segments.
 * @returns The decoded segments in play order.
 * @throws If any segment is malformed.
 */
export function decodeSoundExpression(dataString: string): DecodedSoundSegment[] {
  return dataString.split(",").map(decodeSegment);
}

/**
 * Decodes a built-in sound emoji to its segments by name. Returns undefined for
 * a name outside the built-in set (the same names the speaker port resolves).
 *
 * @param name - A built-in sound name (for example `hello`).
 */
export function decodeBuiltInSound(name: string): DecodedSoundSegment[] | undefined {
  const def = findBuiltInSound(name);
  return def === undefined ? undefined : decodeSoundExpression(def.encoded);
}

/**
 * Decodes every built-in sound into a name-keyed map of segments. An app
 * renderer builds this once as a static lookup for all built-ins.
 */
export function decodeAllBuiltInSounds(): Map<string, DecodedSoundSegment[]> {
  return new Map(BUILT_IN_SOUNDS.map((def) => [def.name, decodeSoundExpression(def.encoded)]));
}

/**
 * Which CODAL effect function a raw effect slot invokes at each of its step
 * boundaries. Mirrors the function pointers `SoundExpressions::parseSoundExpression`
 * wires into a `SoundEffect`'s three slots:
 *
 * - Slot 0 (frequency interpolation) is one of `none` / `linear` / `curve` /
 *   `logarithmic` / `exponential-rising` / `exponential-falling` /
 *   `arpeggio-ascending` / `arpeggio-descending`.
 * - Slot 1 is always `volume-ramp`.
 * - Slot 2 (modulation) is `none` / `frequency-vibrato` / `volume-tremolo` /
 *   `warble`.
 */
export type RawEffectKind =
  | "none"
  | "linear"
  | "curve"
  | "logarithmic"
  | "exponential-rising"
  | "exponential-falling"
  | "arpeggio-ascending"
  | "arpeggio-descending"
  | "volume-ramp"
  | "frequency-vibrato"
  | "volume-tremolo"
  | "warble";

/**
 * One raw effect slot of a {@link RawSoundEffect}, mirroring a CODAL `ToneEffect`.
 * The synthesizer fires the slot's effect function at each of its
 * {@link RawToneEffect.steps} step boundaries, mutating the live frequency or
 * volume for the samples that follow.
 */
export interface RawToneEffect {
  /** The CODAL effect function this slot invokes. */
  readonly kind: RawEffectKind;

  /**
   * Number of time-steps the effect is spread across (CODAL's `ToneEffect.steps`,
   * clamped to at least 1 by the renderer). Zero for a `none` slot.
   */
  readonly steps: number;

  /**
   * CODAL `ToneEffect.parameter[0]`: the end frequency in Hz for a
   * frequency-interpolation slot, the end volume on the normalized 0-1 scale for
   * the `volume-ramp` slot, or the per-step vibrato/tremolo/warble multiplier for
   * a modulation slot. Zero for `none` and the arpeggio slots (which read
   * {@link progression} instead).
   */
  readonly param0: number;

  /**
   * Frequency multipliers of the musical progression an arpeggio slot steps
   * through (CODAL's `Progression.interval`). Present only for the arpeggio
   * kinds; undefined otherwise.
   */
  readonly progression?: readonly number[];
}

/**
 * The raw, CODAL `SoundEffect`-shaped decode of one sound-expression segment:
 * the base tone plus the three effect slots exactly as
 * `SoundExpressions::parseSoundExpression` builds them. This is the input the
 * faithful PCM synthesis port (`sound-synthesis.ts`) consumes;
 * {@link DecodedSoundSegment} is the friendlier derived view.
 */
export interface RawSoundEffect {
  /** Tone-generator waveform (CODAL `SoundEffect.tone`). */
  readonly waveform: SoundWaveform;

  /** Base (central) frequency in Hz (CODAL `SoundEffect.frequency`). */
  readonly frequency: number;

  /**
   * Base (central) volume on CODAL's normalized 0-1 scale (CODAL
   * `SoundEffect.volume`, the parsed 0-1023 volume divided by 1023).
   */
  readonly volume: number;

  /** Segment duration in milliseconds (CODAL `SoundEffect.duration`). */
  readonly durationMs: number;

  /**
   * The three effect slots in CODAL order: slot 0 frequency interpolation, slot 1
   * volume ramp, slot 2 modulation.
   */
  readonly effects: readonly [RawToneEffect, RawToneEffect, RawToneEffect];
}

/**
 * Chromatic frequency-multiplier intervals CODAL builds every musical
 * progression from (`MusicalIntervals::chromaticInterval`, the default
 * non-`JUST_SCALE` values).
 */
const CHROMATIC_INTERVAL: readonly number[] = [
  1.0, 1.0417, 1.125, 1.2, 1.25, 1.3333, 1.4063, 1.5, 1.6, 1.6667, 1.8, 1.875,
];

/** Selects the chromatic intervals at the given indices to build a scale. */
function scale(indices: readonly number[]): readonly number[] {
  return indices.map((i) => CHROMATIC_INTERVAL[i] as number);
}

/** The CODAL musical progressions reachable from a sound-expression shape field. */
const PROGRESSIONS = {
  majorScale: scale([0, 2, 4, 5, 7, 9, 11]),
  minorScale: scale([0, 2, 3, 5, 7, 8, 10]),
  diminished: scale([0, 3, 6, 9]),
  chromatic: CHROMATIC_INTERVAL,
  wholeTone: scale([0, 2, 4, 6, 8, 10]),
} as const;

/** CODAL's normalized 0-1 volume for a parsed 0-1023 volume field. */
function normalizeVolume(value: number): number {
  const clamped = Math.min(Math.max(value, 0), 1023);
  return clamped / 1023;
}

/** Builds slot 0 (frequency interpolation) from the shape field and end frequency. */
function rawFrequencySlot(shape: number, steps: number, endFrequency: number): RawToneEffect {
  switch (shape) {
    case 1:
      return { kind: "linear", steps, param0: endFrequency };
    case 2:
      return { kind: "curve", steps, param0: endFrequency };
    case 5:
      return { kind: "exponential-rising", steps, param0: endFrequency };
    case 6:
      return { kind: "exponential-falling", steps, param0: endFrequency };
    case 18:
      return { kind: "logarithmic", steps, param0: endFrequency };
    case 8:
      return { kind: "arpeggio-ascending", steps, param0: 0, progression: PROGRESSIONS.majorScale };
    case 10:
      return { kind: "arpeggio-ascending", steps, param0: 0, progression: PROGRESSIONS.minorScale };
    case 12:
      return { kind: "arpeggio-ascending", steps, param0: 0, progression: PROGRESSIONS.diminished };
    case 14:
      return { kind: "arpeggio-ascending", steps, param0: 0, progression: PROGRESSIONS.chromatic };
    case 16:
      return { kind: "arpeggio-ascending", steps, param0: 0, progression: PROGRESSIONS.wholeTone };
    case 9:
      return { kind: "arpeggio-descending", steps, param0: 0, progression: PROGRESSIONS.majorScale };
    case 11:
      return { kind: "arpeggio-descending", steps, param0: 0, progression: PROGRESSIONS.minorScale };
    case 13:
      return { kind: "arpeggio-descending", steps, param0: 0, progression: PROGRESSIONS.diminished };
    case 15:
      return { kind: "arpeggio-descending", steps, param0: 0, progression: PROGRESSIONS.chromatic };
    case 17:
      return { kind: "arpeggio-descending", steps, param0: 0, progression: PROGRESSIONS.wholeTone };
    default:
      return { kind: "none", steps, param0: 0 };
  }
}

/** Builds slot 2 (modulation) from the fx-choice field. */
function rawModulationSlot(fxChoice: number, steps: number, fxParam: number): RawToneEffect {
  switch (fxChoice) {
    case 1:
      return { kind: "frequency-vibrato", steps, param0: fxParam };
    case 2:
      return { kind: "volume-tremolo", steps, param0: fxParam };
    case 3:
      return { kind: "warble", steps, param0: fxParam };
    default:
      return { kind: "none", steps: 0, param0: 0 };
  }
}

/**
 * Decodes one 72-character sound-expression segment into its raw, CODAL
 * `SoundEffect`-shaped form, wiring the three effect slots exactly as
 * `SoundExpressions::parseSoundExpression` does: slot 0 from the shape field
 * (with the end frequency or arpeggio progression), slot 1 the fixed 36-step
 * volume ramp to the end volume, and slot 2 the modulation from the fx-choice
 * field. Randomization fields read as zero, so the decode is deterministic.
 *
 * @param segment - A single 72-character segment.
 * @returns The raw decoded effect.
 * @throws If the segment is not 72 characters or contains a non-digit field.
 */
function decodeRawSegment(segment: string): RawSoundEffect {
  if (segment.length !== CHARS_PER_SEGMENT) {
    throw new Error(`sound-expression segment must be ${CHARS_PER_SEGMENT} chars, got ${segment.length}`);
  }
  const wave = parseField(segment, 0, 1);
  const volume = parseField(segment, 1, 4);
  const frequency = parseField(segment, 5, 4);
  const duration = parseField(segment, 9, 4);
  const shape = parseField(segment, 13, 2);
  const endFrequency = parseField(segment, 18, 4);
  const endVolume = parseField(segment, 26, 4);
  const steps = parseField(segment, 30, 4);
  const fxChoice = parseField(segment, 34, 2);
  const fxParam = parseField(segment, 36, 4);
  const fxnSteps = parseField(segment, 40, 4);

  const fields = [
    wave,
    volume,
    frequency,
    duration,
    shape,
    endFrequency,
    endVolume,
    steps,
    fxChoice,
    fxParam,
    fxnSteps,
  ];
  if (fields.some((value) => Number.isNaN(value))) {
    throw new Error(`sound-expression segment has a malformed field: "${segment}"`);
  }

  // CODAL spreads the modulation steps evenly across the duration, then stores
  // the result in an int ToneEffect.steps field (truncating toward zero).
  const modulationSteps = Math.trunc((duration / 10000) * fxnSteps);
  return {
    waveform: waveformFromField(wave),
    frequency,
    volume: normalizeVolume(volume),
    durationMs: duration,
    effects: [
      rawFrequencySlot(shape, steps, endFrequency),
      { kind: "volume-ramp", steps: 36, param0: normalizeVolume(endVolume) },
      rawModulationSlot(fxChoice, modulationSteps, fxParam),
    ],
  };
}

/**
 * Decodes a micro:bit sound-expression data string into its ordered raw
 * effects. This is the CODAL `SoundEffect`-shaped decode the faithful PCM
 * synthesis port consumes; every segment maps to one CODAL `SoundEffect`.
 *
 * @param dataString - Comma-separated 72-character sound-expression segments.
 * @returns The raw effects in play order.
 * @throws If any segment is malformed.
 */
export function decodeSoundExpressionRaw(dataString: string): RawSoundEffect[] {
  return dataString.split(",").map(decodeRawSegment);
}

/**
 * Decodes a built-in sound emoji to its raw effects by name. Returns undefined
 * for a name outside the built-in set.
 *
 * @param name - A built-in sound name (for example `hello`).
 */
export function decodeBuiltInSoundRaw(name: string): RawSoundEffect[] | undefined {
  const def = findBuiltInSound(name);
  return def === undefined ? undefined : decodeSoundExpressionRaw(def.encoded);
}
