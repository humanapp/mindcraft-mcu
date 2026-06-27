# Spec: audio functions

A device's speaker is a single shared sound output. This spec is the home for the **family of
functions that produce sound** - their shared arbitration model, the async-play pattern they
follow, and the `Sound` type they consume. It is the audio counterpart of the display draw
family (`display.md`): the same three-surface delivery, registered-Struct-literal type, leased
single output, and formula-based completion apply. The high-value capability is **authoring fun
sound effects** (a ramping saw wave with tremolo, sci-fi sweeps, and the like) in an editor and
playing them on the device; the device's built-in named sounds play through the same tile. The
family model and types are **target-agnostic**; the audio capability (speaker, waveforms,
effects, pitch range, built-in sounds) is **defined by the target**. The first - and currently
only - target is micro:bit-v2. The first member is **play sound**.

This is an evolving family spec; the settled design is below, with unresolved items collected under
**Open questions** at the end. Musical note sequences, melodies, and chords are a deliberately
deferred direction (see Open questions) - not the near-term focus.

## Target parameterization

The cross-target parts of this spec - the family model, the lease arbitration, the async-play
pattern, and the `Sound` structure - do not assume a synthesis engine or a fixed sound set. The
target defines:

- **Audio capability.** Whether a speaker exists, the available waveforms and effects, the usable
  pitch range, and any built-in sound library.
- **Pitch realization.** How an authored frequency maps to a played tone is the target's.

The cross-target layer owns the sound-effect / sound-expression **concepts**; the target fills in
the synthesis. Only micro:bit-v2 is specified and built here; another target (for example an
Arcade device) slots in as a new target without changing the family model or the `Sound` type.

## The speaker as a shared output

- One speaker per device.
- Sound is transient: a play produces sound for its duration and then stops; there is no held
  state to overwrite (unlike the display's persistent image).
- Play functions are **temporal**: a sound takes observable time. Each is an async host-action
  (op 45 `HOST_ACTION_CALL_ASYNC` + `AWAIT`); the rule parks until the sound completes. There is
  no instantaneous audio stance.

## Surfaces

The audio family is delivered on the three standard surfaces:

- **Tiles.** The `play sound` actuator (with an optional `interrupt` modifier)
  plus a **`create a sound`** factory tile that opens the sound-effect editor and produces a
  `Sound` value. The device's built-in named sounds are also selectable on `play sound`.
- **Device API.** `ctx.microbit.audio` (registry: `microbit-context.md`) gains
  a play method with an optional **`interrupt`** flag (e.g. `playSound(sound, interrupt = false)`);
  the `Sound` type is visible to TS user code.
- **Simulator - the sound-effect editor.** A **custom literal factory** bound to the `Sound`
  type - a simplified, friendlier sfxr: the controls are the `Sound` fields (waveform, base
  frequency, duration, volume, a frequency sweep, a vibrato, and a volume envelope / fade in-out),
  with live preview. It builds the `Sound` literal the `create a sound` tile manufactures.
  Editor-only: the editor UI is not on the parity path (the compiled `Sound` value is - see
  Conformance).

## Arbitration: the speaker lease

The speaker is a single output, leased by the playing sound for its duration - the same model as
the display.

- The lease is a **target-layer concept resolved against VM tick time** - deterministic and
  parity-matchable - **not** a device-driver busy/done state. Completion is a pure function of the
  sound's encoded durations, settled in the host-loop drain when VM tick time reaches it. The
  device-driver completion event (CODAL's `EVT_DONE` / mixer-silence) is never the completion
  signal - it is non-deterministic and does not reliably fire on hardware.
- The dispatching rule `AWAIT`s the lease and resumes on the first `think()` past completion;
  while parked it does not re-fire.
- **By default a `play sound` dispatched while a sound is playing is rejected**: the new sound is
  **dropped - not played, the actuator completes immediately, no error** (a missed feedback sound
  must not fault a reactive rule). There is no queue or mixing.
- **An `interrupt` modifier overrides that**: the new sound **stops the current one and takes the
  speaker** - the interrupted sound's awaiting rule **resolves** (it continues, not an error), and
  the new sound plays for its duration. `interrupt` is available on the actuator (the Tiles) and
  the the Device API.
- Determinism: rule execution order within a round is deterministic, so which sound holds the
  speaker - and whether a competitor is dropped or interrupts - is a deterministic function of
  round order + the `interrupt` flag.

No mixing bus or voice pool is built: a single sound effect is monophonic, and concurrent
playback (the only polyphony case) is handled by the lease, not by summing voices.

## Async-play pattern

- Dispatched as op 45 `HOST_ACTION_CALL_ASYNC`, returning a handle the rule `AWAIT`s - the same
  machinery as `pause` and the display family.
- The sound is rendered by the target's synthesis engine (the device sequences the effect's
  segments itself; the sim renders via Web Audio). The VM does not synthesize - it hands the whole
  sound to the target and awaits the total.
- **Completion = `start + sum(segment durations)` vs VM tick time**, computed from the sound's
  encoded segments. The device-driver completion event is not used.

## Durations and looping

- Every sound segment carries an **explicit duration**, so a sound's total length is known before
  it starts and the completion tick is computable.
- **Looping is not supported.** A device driver treats a **negative duration** as "loop forever";
  we reject that. A sound segment with a negative duration is **silently dropped - not played, and
  not a fault** (no `ScriptError`). The drop happens in the **target audio port, in both VMs,
  before anything reaches the driver**, so the driver never receives a negative duration and never
  loops.
- The drop is **per-segment**: a sound keeps its finite segments and plays them; if filtering
  empties a sound entirely, the actuator resolves immediately (a no-op). **Zero duration is
  allowed** - a zero-length segment that contributes 0 to the total.

## Member: play sound

- An async actuator placed in `do`. Plays a `Sound` - either an authored sound effect (from a
  `create a sound` factory tile or a `Sound` variable) or one of the target's built-in named
  sounds. An optional **`interrupt`** modifier selects the busy behavior (see Arbitration):
  `play sound <sound>` is reject-by-default; `play sound <sound> interrupt` stops a playing sound
  and takes the speaker.
- Behavior: when the speaker is free, the sound's encoded segments are handed to the target's
  synthesis engine, the rule awaits the total duration, and the speaker is leased for that time.
  When busy: default drops the new sound and completes immediately; `interrupt` stops the current
  sound (its rule resolves) and plays.
- Completion: `start + sum(segment durations)` vs VM tick time. Negative-duration segments are
  dropped per Durations and looping.

## The `Sound` type

- A `Sound` is a **registered Struct type** - not a new VM primitive. It reuses the existing
  struct and literal machinery (both VMs already implement structs), so the runtime needs nothing
  new. This mirrors the `Image` / `Vector2` pattern: a registered struct plus a custom literal
  editor (a `CustomLiteralType` whose `renderInputFields` is the editor), registered against the
  core factory API (`BrainTileFactoryDef` / `api.defineType` / `registerLiteralFactoryTileDef`).
- It holds an authored **sound effect**, a struct that mirrors CODAL's `SoundEffect` parameter
  set but exposed as friendly, simplified-sfxr controls (not raw function pointers, and not
  CODAL's opaque 72-char sound-expression string):
  - **base** frequency (Hz), volume, and duration (ms);
  - a **waveform** enum - sine / sawtooth / triangle / square (with a duty parameter) / noise;
  - up to **three effect slots** as named controls - a **frequency ramp** (an end frequency the
    pitch ramps to over the duration, the base frequency being the start; up if higher, down if
    lower, steady if equal; optional ramp shape), a **vibrato** (depth + rate), and a **volume
    envelope** (a fade-in / fade-out, i.e. attack + decay). Three named controls map exactly onto
    CODAL's three `SoundEffect` effect slots.
  - A `Sound` is one such segment, or a `List` of them for a multi-stage sound (e.g. a zap then a
    tail). Segment encoding (a `List` of segment structs vs a packed form) is pinned at
    implementation; see Open questions.
- The struct mirrors the parameters, not CODAL's representation: the **target port encodes a
  `Sound` to a CODAL `SoundEffect[]`** on device (waveform enum -> tone function, each control ->
  the matching effect function), and renders it via Web Audio in the sim. The cross-target layer
  writes only that encoder + the sim renderer - no custom DSP (the target's synth generates the
  sound; see micro:bit-v2).
- **Instances are literals.** A `Sound` value is created by the `create a sound` factory tile
  (the Tiles), whose editor (the Simulator) builds the struct; the literal is baked into the brain
  program as a constant and passed to `play sound`.
- The effect parameters' realization (frequency -> tone, the waveform and effect set) is
  **target-interpreted**. The struct *shape* is target-agnostic, but the *type registration* is
  **target-side**, because the synthesis capability is target-owned.

## Sound-effect editor (the Simulator)

The custom literal factory bound to `Sound` - a **simplified, friendlier jsfxr**. In microbit-sim
it is deliberately **basic** (labeled sliders + a few buttons, just to express the functionality;
a more polished editor can come later). Each control maps directly to a `Sound` field, which maps
to a CODAL `SoundEffect` slot:

- **Waveform** - sine / sawtooth / triangle / square / noise (a row of buttons); a **duty** slider
  appears when square is selected.
- **Frequency** - the start pitch (Hz).
- **End frequency (ramp)** - the pitch the frequency ramps to over the duration: above the start
  ramps up, below ramps down, equal stays steady; with an optional ramp shape (linear default;
  logarithmic / curve / exponential). This is the frequency-interpolation slot.
- **Duration** - total length (ms).
- **Volume** - overall level.
- **Vibrato** - depth + speed.
- **Envelope** - fade-in (attack) + fade-out (decay) (the volume slot).
- **Preview** - a play button (Web Audio) to hear the sound while editing.
- **Presets / randomize** (recommended - the "fun" of sfxr; can be phased): a few one-click
  generators (laser, power-up, explosion, pickup, jump, blip) plus a randomize / mutate button,
  each just filling the controls above. Optional; the manual controls are the baseline.

Excluded (absent from CODAL `SoundEffect`, and out of scope for "simpler"): low/high-pass
filters, phaser / flanger, bit-crush.

## micro:bit-v2 target

The concrete fill-in of the target-parameterized pieces for micro:bit-v2:

- **Speaker:** the on-board MEMS speaker via `uBit.audio` (`MicroBitAudio`); master volume 0-255.
- **Synthesis (use CODAL's, build no custom generator):** `SoundEmojiSynthesizer` already
  generates the oscillator, applies the effects, and sequences segments in real time. The target
  port only **encodes a `Sound` to a CODAL `SoundEffect[]`** and plays it; there is no custom DSP.
  The mapping:
  - waveform -> `Synthesizer` tone function (`SineTone` / `SawtoothTone` / `TriangleTone` /
    `SquareWaveTone` or `SquareWaveToneExt` with duty / `NoiseTone`);
  - frequency ramp -> a frequency-interpolation effect (`linearInterpolation` default;
    `logarithmicInterpolation` / `curveInterpolation` / `exponentialRising`/`FallingInterpolation`):
    the base `SoundEffect.frequency` is the start, the effect's `parameter[0]` is the end
    frequency, interpolated over the steps (up or down);
  - vibrato -> `frequencyVibratoEffect` / `vibratoInterpolation` (and `warbleInterpolation` /
    `volumeVibratoEffect` tremolo are available);
  - volume envelope / fades -> `volumeRampEffect` (or `adsrVolumeEffect`).
  A `SoundEffect` has **3 effect slots** (`EMOJI_SYNTHESIZER_TONE_EFFECTS = 3`), 2 params each -
  enough for the sweep + vibrato + envelope set above; richer sounds chain `SoundEffect`
  segments. A single voice is used; `Mixer2` exists but no polyphony is built. (Filters / phaser /
  bit-crush are not in `SoundEffect` - deliberately out of the simplified editor.)
- **Built-in sounds:** the 10 CODAL sound emoji - `giggle`, `happy`, `hello`, `mysterious`, `sad`,
  `slide`, `soaring`, `spring`, `twinkle`, `yawn` (each a name mapped to an encoded
  sound-expression data string; an unrecognized string plays as raw encoded data, so authored
  sounds use the same path). These are micro:bit-specific (`SoundExpressions`, codal-microbit-v2).
- **Completion:** resolved on the duration formula; CODAL's message-bus completion events are
  ignored.
- **`Sound` type:** the registered struct authored by the `create a sound` factory tile + the
  sound-effect editor (the Simulator); type-atom id appended at implementation (append-only).
- **play sound:** action / function ids assigned at implementation (append-only). On device the
  sound expression is sequenced by the synthesizer; in the sim it renders via the Web Audio API
  (an oscillator with the chosen waveform, a gain envelope, and an LFO for vibrato/tremolo).

## Conformance

- The wodal microbit module is the oracle; the C++ port mirrors it. Audio output is **not**
  byte-trace-matchable (it is an analog waveform), so parity is over the **play command** issued
  to the audio port - the sound's encoded segments (or built-in name) + durations - not the sound.
  Trace: an audio-port line for the play plus the async `action ... async` dispatch line.
  Completion resolves on VM tick time (the duration formula), so the trace is deterministic and
  reproducible across both VMs.
- The compiled `Sound` value is a brain-program constant and is on the parity path (both VMs derive
  the same play command from it). The Simulator editor UI that authors it, and the rendered sound,
  are sim-only and not byte-matched.
- The lease outcome (which `play sound` holds the speaker, which a busy speaker rejects) is part of
  the trace and is deterministic via round order + the per-sound formula.
- The device-driver completion event is not on the parity path.

## Open questions

1. **`Sound` struct details** (shape resolved: mirrors CODAL's `SoundEffect` - base freq/vol/
   duration + waveform enum + sweep / vibrato / envelope controls, segments as a `List`). Left to
   pin: parameter ranges + units, the segment encoding (`List` of structs vs packed), and which
   CODAL variants the named controls expose (e.g. sweep shape options; whether tremolo / warble
   are surfaced as separate controls or folded into vibrato).
2. **`play sound` argument**: the built-in set as an enum modifier vs always a `Sound` value
   (built-ins exposed as named `Sound` constants); whether `create a sound` can also start from a
   built-in as a template.
3. **Sim fidelity**: how faithfully the Web Audio renderer reproduces CODAL's sweeps + effects -
   exact reproduction vs a good-enough approximation (the traced command is the parity anchor
   either way).
4. **Musical notes / melodies / chords (deferred direction).** Pitched note sequences and chords
   were considered and deprioritized below sound effects. Reviving them would add a `Melody`-style
   type and, for chords, a mixing arbitration (a voice cap + over-cap policy) that replaces the
   single-output lease. Out of scope until prioritized.
5. **How far to formalize the target seam now**: the audio capability seam is settled, but the
   minimal interface a target exposes (waveform/effect set, built-in sounds, the encode-to-driver
   hook) is specified only as far as micro:bit needs until a second audio target is scoped.
