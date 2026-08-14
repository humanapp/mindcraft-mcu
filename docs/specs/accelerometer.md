# Spec: accelerometer

The micro:bit accelerometer feature across the surfaces it is exposed through: the **Tiles** surface
(the `gesture` sensor tile; Identity ... Device and trace, below), the ambient **accelerometer struct**
(read-only `x`/`y`/`z`/`pitch`/`roll` for brain code; see Accelerometer struct), and the **Device API**
(the continuous `ctx.microbit.accelerometer.*` reads; see Device API). The cross-cutting `ctx.microbit.*`
conventions and the Device-API registry index live in `docs/specs/microbit-context.md`.

## Identity

The accelerometer is a single device (no input family like the four buttons), so its **Tiles**
surface is **one sensor tile** (`gesture`) with a modifier choosing which gesture fires the rule. The
continuous readings (x/y/z, pitch/roll) are values, not rule triggers - reached in the brain editor
through the ambient **accelerometer struct** (read-only fields, via accessor tiles) and in TS user code
through the **Device API** (see both below).

| Field         | Value |
| ------------- | ----- |
| Kind          | sensor |
| Stance        | poll sensor - reads the current gesture each tick (sync, instantaneous; no async handle) |
| Composability | non-inline (rule trigger only) |
| Tile key      | `microbit-v2.gesture` (label "gesture") |
| Action id     | 1030 |
| Function id   | 1047 |
| Module        | microbit-v2 (`mindcraft.microbit-v2`) |

Action and function ids are wire-stable: once assigned they are never changed or reused.

## Authoring

The `[gesture]` tile is true while a chosen gesture is recognized; one optional,
mutually-exclusive modifier selects which:

`[shake]` `[tilt left]` `[tilt right]` `[tilt up]` `[tilt down]` `[face up]` `[face down]`
`[freefall]` `[impact]`

**Default modifier = `[shake]`** (resolved in the body). `[freefall]` is a plain standalone
gesture (a fall, ~0G); it takes no sub-modifier.

**`[impact]` unlocks a g-force-level sub-modifier** - a hard hit / high-G spike, the opposite
end of the scale from freefall's 0G. When `[impact]` is selected, an additional optional,
mutually-exclusive sub-modifier becomes available - `[2g]` `[3g]` `[6g]` `[8g]`. Bare `[impact]`
matches any detected impact; `[impact] [<N>g]` matches an impact of at least N G, mapping to
CODAL's 2G/3G/6G/8G impulse levels.

**Every modifier emits a LEVEL signal: true on every tick the gesture is recognized**, false
otherwise - uniform across all gestures. Edge / fire-once / toggle behavior is obtained by
composing a **relay** (`docs/specs/relays.md`), the same way for every sensor, rather
than per-gesture variants here.

```
when: gesture                  // defaults to: shake
when: gesture shake
when: gesture tilt left
when: gesture face up
when: gesture freefall         // a fall (~0G)
when: gesture impact           // any hard hit (>= ~2G)
when: gesture impact 6g        // a hit of at least 6G
when: gesture face up once     // trigger once on each facing-up detection
```

## Modifier grammar

`optional(choice(mod ...))` over the core call-spec grammar, the same shape as the button
sensor:

```
callDef = mkCallDef(
  bag(
    optional(choice(
      mod(Shake), mod(TiltLeft), mod(TiltRight), mod(TiltUp),
      mod(TiltDown), mod(FaceUp), mod(FaceDown), mod(Freefall),
      mod(Impact)            // named so the conditional below can reference it
    )),
    // g-force-level sub-modifiers available only when impact was selected
    optional(conditional("impact", optional(choice(
      mod(G2), mod(G3), mod(G6), mod(G8)
    ))))
  )
)
```

Mutually exclusive; the default is resolved in the body (not the grammar); not `repeated`. The
`conditional("impact", ...)` is the same mechanism `move` uses for its actor-ref - the g-force
sub-choice is in scope only when `[impact]` is selected.

## Behavior

- **For the eight polled gestures the tile polls `getGesture()` and compares to its modifier.**
  `getGesture()` is a sync poll (not a bus listener) returning the current gesture code; the
  tile is true while that equals its modifier's gesture. The gesture value's source depends on
  the runtime: on device, CODAL's `uBit.accelerometer.getGesture()`; in the interactive sim, a
  faithful wodal detector over simulated motion; in parity goldens, an injected gesture code.
  CODAL owns the x/y/z->gesture algorithm; cpp never reimplements it (the wodal detector mirrors
  it for sim fidelity only).
- **`getGesture()` is single-valued, so the polled gestures are mutually exclusive.** It returns
  one code (or idle), so at most one is recognized at any tick - you cannot match `tilt left` and
  `face up` at the same instant. Independent call-sites of the same gesture all see that one
  value and fire together; distinct-gesture tiles are never true on the same tick.
- **`[impact]` is detected by magnitude, not by the polled gesture.** A high-G impulse is
  surfaced by CODAL as an event rather than through `getGesture()`, and reaching the thresholds
  requires the accelerometer's range raised above the default +-2G. The tile recognizes impact
  by thresholding the acceleration magnitude (CODAL's `instantaneousAccelerationSquared`) against
  the 2G/3G/6G/8G levels: bare `[impact]` matches any impact; `[impact] [<N>g]` matches at least
  N G. The CODAL impact codes are not numerically ordered, so matching is a `>=` over an explicit
  code->rank map (2G < 3G < 6G < 8G), never a raw-code compare. An impact is a momentary impulse:
  its signal has a short defined lifetime so it never sticks or masks a later gesture.
- **Level signal.** The tile is true on every tick its gesture is recognized, false otherwise -
  uniform across all gestures, no per-gesture edge/level split and no debounce. (For `shake` and
  an impact the recognized window is brief; for the postures it is sustained - both are just
  "true while recognized".) Edge / fire-once / toggle behavior comes from a composed relay, not
  this tile.
- **Independent, no suppression** (modifiers and call-sites), matching buttons.

## Timing / derivation

**No detection thresholds are ours** - CODAL owns the x/y/z->gesture algorithm (tilt tolerance,
shake zero-crossing + damping, face threshold) and the impact magnitude thresholds. What the
contract pins is the **gesture enum**: CODAL's accelerometer gesture codes adopted verbatim - the
idle/`none` code, the tilt/face/shake/freefall codes, and the 2G/3G/6G/8G impact codes - shared
by both VMs so the device needs no translation layer (CODAL's `getGesture()` value is the enum)
and an injected value equals what the device reports. The tile is a pure level over the current
gesture; there is no debounce window.

## Device and trace

- Device port: `AccelerometerInputPort` on `DevicePorts` exposing `getGesture()` (the gesture
  code, for this tile) plus `getX()`/`getY()`/`getZ()` (mg) and `getPitch()`/`getRoll()` (for
  the Device API). Bound to `uBit.accelerometer` on device; a stub on the cpp host build + the wodal
  sim (the injection point), like `ButtonInputPort`.
- **Device activation:** on hardware `getGesture()` calls CODAL's `requestUpdate()` before
  reading. CODAL's gesture getter does not self-update (unlike the value getters), so the
  accelerometer's sampling and gesture detection only start once an update is requested;
  otherwise it reads NONE. The host stub + wodal need no such call (they return injected values).
- Injectable input (test-only): the gesture enum for this tile, and x/y/z + pitch/roll scalars
  for the Device-API reads. The injection path lives only on the cpp host + wodal builds and is
  excluded from the device firmware; on device the port is CODAL-bound with no injection hook. No
  x/y/z->gesture derivation runs on the parity path.
- The injected gesture is a **held value**: a golden sets a gesture code and it persists until
  the script changes or clears it, mirroring CODAL's `getGesture()` (which holds the last gesture
  until a new one is detected).
- Observable trace (format version 1): the chosen gesture firing reuses the existing sensor-fire
  `action` trace line.

## Device API (`ctx.microbit.accelerometer`)

The continuous reads for the accelerometer. These are values (not rule triggers), so they are not a
rule-trigger tile; in the brain editor they are reached through the ambient **accelerometer struct**
(below), and in TS user code through the Device API here. They **share the same per-`think()` poll**
the `gesture` tile consumes (one poll, all surfaces).

| `ctx.microbit.accelerometer.*` | Returns | Notes |
| ------------------------------ | ------- | ----- |
| `getX()` / `getY()` / `getZ()` | number (mg) | raw acceleration per axis |
| `getPitchRadians()` / `getRollRadians()` | number (radians) | the orientation primary; CODAL's on device, injected directly on the test-only path |
| `getPitch()` / `getRoll()`     | number (whole degrees) | DERIVED from radians via CODAL's exact f32 formula `(int)(360*rad/(2*PI))`, both VMs (not derived from x/y/z, not independently polled) |
| `getGesture()`                 | number (gesture code) | the current gesture enum (CODAL `ACCELEROMETER_EVT_*` codes verbatim); the same value the `gesture` tile compares against |

- `AccelerometerInputPort` (`getGesture`, `getX/getY/getZ`, `getPitch/Roll` +
  `getPitchRadians/RollRadians`) on `DevicePorts`, bound to `uBit.accelerometer`.
- Sync reads (instantaneous), per the Device-API stance.
- **Singleton struct - no discriminator** (unlike the buttons, which key one shared `isPressed` body
  by receiver): the `accelerometer` field resolves to one struct value and each of the 8 reads binds
  a distinct host-function body.
- **Not 1:1 with the tile:** TS user-code gets the raw values + pitch/roll + the current
  `getGesture()` code; the gesture *tile* (the Tiles) adds the modifier-match + level semantics on
  top of `getGesture()`.
- **ABI ids (append-only):** `MicroBitField.Accelerometer = 4` (appended LAST per the
  native-struct field-order invariant - see `microbit-context.md`), type-atom `1028`, host-function
  ids `1039-1046` (getX 1039, getY 1040, getZ 1041, getPitchRadians 1042, getRollRadians 1043,
  getPitch 1044, getRoll 1045, getGesture 1046).

## Accelerometer struct (ambient read-only value)

The continuous reads are surfaced in the brain editor as an **ambient read-only struct** - the same
pattern as the game engine's `me` self-actor: a struct-typed value named `accelerometer`, available in
**any** expression (no rule trigger, no gating), whose fields are read through the editor's existing
struct-field **accessor** tiles. This gives brain code direct, always-available access to orientation
and acceleration - e.g. `accelerometer.pitch` to steer continuously - without a gesture having to fire.

- **Fields (read-only):** `x`, `y`, `z` (mg) and `pitch`, `roll` (whole degrees). The struct exposes
  live sensor state; the fields have no setter.
- **Live values via a field getter.** The fields are computed on read by a struct field getter bound to
  the accelerometer port (`getX/Y/Z`, `getPitch/Roll`), sharing the same per-`think()` poll the
  `gesture` tile and Device API consume (one poll, all surfaces). Reading a field returns the current
  sample.
- **Access via accessor tiles.** `accelerometer` is a struct value, so the editor offers one accessor
  tile per field (`tile.accessor->{Accelerometer struct}->{field}`) and the type-compatibility system
  slots each field's number into matching value slots - the existing struct-field mechanism, no new
  tile kind and no VM change.
- **Available anywhere.** Unlike the `gesture` tile (a rule trigger), the `accelerometer` struct is an
  ambient value usable in any rule, WHEN or DO, with no triggering event - the right fit for continuous
  reads. The radians reads (`getPitchRadians/RollRadians`) and the gesture code stay Device-API-only;
  acceleration strength (`sqrt(x^2+y^2+z^2)`) is composable from the fields.
- **ABI:** a registered struct type (id assigned at build, append-only) whose field getter reuses the
  existing `AccelerometerInputPort` reads; no new host functions beyond those reads.

## Simulator (apps/microbit-sim)

A **gesture-picker dropdown**, one per simulated device, at the top of each micro:bit simulator
card, above the 5x5 screen. Selecting a gesture **injects an animated x/y/z sample sequence**
into that device's `Accelerometer.feedSample(...)`, driving the **real wodal gesture detector** to
recognize it (WYSIWYG); it never writes the gesture enum directly.

- **Contents:** `none` + the eight polled gestures - shake; tilt left/right/up/down; face up;
  face down; freefall. Gesture-only: no x/y/z or pitch/roll sliders or readouts. (Impact, a
  magnitude impulse rather than a polled gesture, is not among the dropdown's gestures.)
- **Behavior:**
  - **Posture gestures** (tilt left/right/up/down, face up/down) are **sticky**: the injected
    sample ramps to the posture and holds; the detector keeps reporting it until the selection
    changes.
  - **shake / freefall** are **momentary**: the injected sequence plays once (shake = an
    oscillating sample crossing CODAL's shake tolerance enough times to trip the zero-crossing
    detector; freefall = a ~0 g sample for its window), then the device returns to the idle
    reading and the dropdown resets to `none`.
  - **`none`** returns the accelerometer to the idle reading.
- **Idle reading:** `(480, -600, -640)` mg (from +-36.87 deg / asin 0.6; magnitude ~1000 mg;
  every axis under the 800 mg tilt/face threshold, so the detector reports None). The wodal
  `Accelerometer` default of `(0, 0, -1000)` mg is not used as idle because flat face-up registers
  as the FaceUp gesture.
- **Ownership:** `wodal` owns the **injection driver** (the `feedSample` sample-sequence animation
  + scheduler), reusable by any front-end; it feeds at the device sample period (~20 ms, off
  `accelerometer.getPeriod()`), decoupled from the brain tick (zero-or-more detector steps per
  `think()` as elapsed time crosses the period), so recognized durations match the device.
  `apps/microbit-sim` owns the dropdown UI and calls the driver for the chosen gesture / `none`.

## CODAL capability coverage

Per the full-surface-design principle, the whole CODAL accelerometer capability set is accounted for;
each item is provided / composable / designed-out / not-built (never silently omitted).

- **Provided:** the `gesture` tile (8 core gestures: shake / 4 tilt / 2 face / freefall); the ambient
  `accelerometer` struct (read-only `x`/`y`/`z`/`pitch`/`roll`, via accessor tiles); Device-API reads
  `getX/Y/Z`, `getPitch/Roll` (+ radians), `getGesture()`.
- **Designed, not currently built: impact + g-force** (the impulse 2G/3G/6G/8G). The `[impact]` +
  `[Ng]` sub-modifiers are designed (Authoring / Behavior above) but not built: CODAL surfaces
  impulses as `DEVICE_ID_GESTURE` **events only** (not pollable via `getGesture()` like the core
  gestures) and needs the range raised above the default +-2G; the recommended approach polls
  `instantaneousAccelerationSquared()` and thresholds against the g-force levels.
- **Composable / designed out:** `getSample()` (the x/y/z vector - composable from the three axis
  reads); acceleration **strength/magnitude** (`sqrt(x^2+y^2+z^2)` from the reads).
- **Config capabilities NOT exposed (designed):** `setRange/getRange` (+-2G/4G/8G) and
  `setPeriod/getPeriod` (sample rate). Both are used **internally** (an impact build raises the range;
  the sim gesture-injector reads `getPeriod()`), but neither is exposed as a Device-API method - no
  consumer. Add them if a consumer needs to configure range/rate.

## Conformance

- The wodal microbit module is the oracle; the C++ port mirrors the level-compare (there is no
  detector to mirror - CODAL owns it). Parity is over the **injected gesture, not the detection
  algorithm**: the harness injects a gesture code, both VMs return it from `getGesture()` and fire
  identically. CODAL's x/y/z->gesture detection is trusted on device and covered by a hardware
  smoke test (a sensor cannot be deterministically trace-matched on real hardware).
- Per-gesture goldens are driven by a scripted gesture-enum schedule - `(tick, code)` setpoints,
  the value held until the next setpoint.
- This is a read surfaced as a poll; no async-handle budget.
