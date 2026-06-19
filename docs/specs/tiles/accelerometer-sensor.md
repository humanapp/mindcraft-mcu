# Tile spec: gesture sensor

(The accelerometer's surface-1 tile. The continuous reads x/y/z/pitch/roll are surface 2,
`microbit-context.md`.)

Status: core gestures (shake / 4 tilt / 2 face / freefall) implemented + hardware-validated
2026-06-18 (both VMs); the `[impact]` modifier + its g-force sub-modifiers are designed below
but DEFERRED - on hardware impacts are CODAL events, not pollable via `getGesture()`, so the
poll-and-compare path does not work for impact (see the delivery note under Behavior). Pairs
with the filters direction (`docs/specs/tiles/filters.md`) for edge/toggle behavior.

## Identity

The accelerometer is a single device (no input family like the four buttons), so surface 1
is **one sensor tile** (`gesture`) with a modifier choosing which gesture fires the rule. The
continuous readings (x/y/z, pitch/roll) are **surface 2 only** (TS user-code,
`microbit-context.md`) - they are values, not rule triggers.

| Field         | Value |
| ------------- | ----- |
| Kind          | sensor |
| Stance        | poll sensor - poll `getGesture()` each tick (a sync poll); parity goldens inject the gesture enum (cpp never derives); wodal has a **faithful detector** for the interactive sim only (see Behavior + Sim UI) |
| Composability | non-inline (rule trigger only) |
| Tile key      | `microbit-v2.gesture` (label "gesture") |
| Function id   | TBD (append-only) |
| Module        | microbit-v2 (`mindcraft.microbit-v2`) |

## Authoring

The `[gesture]` tile is true while a chosen gesture is recognized; one optional,
mutually-exclusive modifier selects which:

`[shake]` `[tilt left]` `[tilt right]` `[tilt up]` `[tilt down]` `[face up]` `[face down]`
`[freefall]` `[impact]`

**Default modifier = `[shake]`** (resolved in the body). `[freefall]` is a plain standalone
gesture (a fall, ~0G); it takes no sub-modifier.

**`[impact]` unlocks a g-force-level sub-modifier.** A hard hit / high-G spike (the opposite
end of the scale from freefall's 0G). When `[impact]` is selected, an additional optional,
mutually-exclusive sub-modifier becomes available - `[2g]` `[3g]` `[6g]` `[8g]` - via the
conditional-grammar pattern (`move`'s `targeted` -> actor-ref). Semantics: bare `[impact]` =
any detected impact; `[impact] [<N>g]` = an impact of at least N G. Maps to CODAL's 2G/3G/6G/8G
impulse gestures. (The sim's spring-back g-force slider produces these automatically - see Sim
UI.)

**Impact is the one modifier matched by magnitude, not equality.** Every other gesture fires
on `getGesture() == modifier`; impact fires when `getGesture()` is *any* impact code (bare) or
an impact code **of at least the selected level** (`[<N>g]`). The body maps each impact code to
its magnitude rank (2G < 3G < 6G < 8G) and does a `>=` compare on the *rank* - so a 6G hit
fires a `[6g]`, a `[3g]`, a `[2g]`, and a bare `[impact]` rule, but not an `[8g]`. Note the
CODAL enum **codes are not numerically ordered** (2G is the highest code value, not the
lowest), so the body needs an explicit code->rank map; it must not compare raw code values. On
the parity
path the injected impact code is the level reached, so the `>=` is exercised directly.

**Delivery note (impact is DEFERRED).** On real hardware impacts do NOT flow through
`getGesture()` at all: CODAL raises them as `DEVICE_ID_GESTURE` events and never writes them to
the pollable `lastGesture` (only postures + shake set that). So the poll-`getGesture()`-and-
compare model above - correct for the core gestures - cannot deliver impact, and the default
`+/-2G` range saturates below the 2G threshold. A revival derives impact by **polling
`instantaneousAccelerationSquared()`** each tick and thresholding it directly (the "derive from
polled state" pattern, like buttons' click/hold), or - as a deliberate exception - consumes
CODAL's gesture events. Impact is a momentary event, not a sustained posture, so a revived
design also needs a defined signal lifetime (e.g. a one-tick latch) so it never sticks or masks
a later gesture. The `>=` rank matching + the conditional grammar above remain the intended
design; only the delivery mechanism is open.

**Every modifier emits a LEVEL signal: true on every tick the gesture is recognized**, false
otherwise - uniform across all gestures. Edge / one-shot / toggle behavior is obtained by
composing a **filter** (`docs/specs/tiles/filters.md`), the same way for every sensor, rather
than per-gesture variants here.

```
when: gesture                  // defaults to: shake
when: gesture shake
when: gesture tilt left
when: gesture face up
when: gesture freefall         // a fall (~0G)
when: gesture impact           // any hard hit (>= ~2G)
when: gesture impact 6g        // a hit of at least 6G
when: gesture face up one-shot // trigger once on each facing-up detection
```

## Modifier grammar

Same shape as the button sensor (`optional(choice(mod ...))`, core call-spec grammar (provisional shape)):

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

Mutually exclusive; default resolved in the body (not the grammar); not `repeated`. The
`conditional("impact", ...)` is the same mechanism `move` uses for its actor-ref - the
g-force sub-choice is in scope only when `[impact]` is selected.

## Behavior

- **The tile polls `getGesture()` and compares to its modifier.** `getGesture()` is a sync
  poll (not a bus listener, so no hardware-listener-didn't-fire hazard) returning the current
  gesture code; the tile is
  true while that equals its modifier's gesture. Where the gesture *value* comes from depends
  on the build/path:
  - **cpp device:** real CODAL `uBit.accelerometer.getGesture()` (CODAL's own detector).
  - **parity goldens (both VMs):** the harness **injects the gesture enum** - no detector runs
    on the byte-compared path, and **cpp never reimplements the detector**.
  - **wodal interactive sim:** a **faithful wodal detector** derives the gesture from the
    globe/slider x/y/z (see Sim UI) - wodal-only, not on the golden path.
  CODAL owns the x/y/z->gesture *definition*; the wodal detector mirrors it for sim fidelity,
  but it is never the parity oracle (the injected enum is). So "don't reimplement the
  detector" applies to **cpp + the parity path**, not to the wodal sim.
- **`getGesture()` is single-valued, so gestures are mutually exclusive.** It returns one code
  (or idle), so at most one gesture is recognized at any tick - you cannot match `tilt left`
  and `face up` at the same instant. Independent call-sites of the *same* gesture all see that
  one value and fire together; distinct-gesture tiles are simply never true on the same tick.
- **Parity is over the injected gesture, not the algorithm.** The harness injects the gesture
  enum ("gesture = SHAKE at tick N"); both VMs return it from `getGesture()` and fire
  identically, so **gesture -> tile-fires** is parity-tested. CODAL's **x/y/z -> gesture**
  detection is NOT parity-tested - it is trusted on device and covered by a hardware smoke
  test (sensors can't be deterministically trace-matched on a real device). The sim needs only
  an approximate gesture model for live UX, not a byte-exact CODAL replica.
- **Level signal (resolved 2026-06-17):** the tile is **true on every tick `getGesture()`
  equals the modifier's gesture**, false otherwise - uniform across all gestures, no
  per-gesture edge/level split and no debounce. (For `shake` the recognized window is brief;
  for the postures it is sustained - both are just "true while recognized".) Edge / one-shot /
  toggle behavior comes from a composed **filter**, not from this tile.
- **Independent, no suppression** (modifiers and call-sites), matching buttons.

## Timing / derivation

**No detection thresholds are ours** - CODAL owns the x/y/z->gesture algorithm (tilt
tolerance, shake zero-crossing + damping, face threshold, etc.). The only thing we pin is the
**gesture enum value mapping** (which numeric code is shake/tilt-left/...), shared by both VMs
and by the injectable harness so an injected "gesture = SHAKE" means the same thing
everywhere. No debounce window (the tile is a pure level over `getGesture()`).

**The enum adopts CODAL's accelerometer gesture codes verbatim** - the idle/`none` code, the
tilt/face/shake/freefall codes, and the `2G/3G/6G/8G` impact codes - so the device needs no
translation layer (CODAL's `getGesture()` value is the enum) and an injected value equals what
the device would report. The concrete numeric list is pinned at implementation against the
CODAL headers; it is not an independent mapping we are free to renumber.

## Device and trace

- Device port: a new `AccelerometerInputPort` on `DevicePorts` exposing `getGesture()` (the
  gesture code, for this tile) plus `getX()`/`getY()`/`getZ()` (mg) and `getPitch()`/
  `getRoll()` (for surface 2). Bound to `uBit.accelerometer` on device; a stub on the cpp
  host build + the wodal sim (the injection point), exactly like `ButtonInputPort`.
- **Device activation (required):** on hardware the port's `getGesture()` must call CODAL's
  `requestUpdate()` before reading. CODAL's gesture getter does not self-update (unlike the
  value getters `getX/getPitch/...`), so the accelerometer's sampling and gesture detection only
  start once an update is requested; a brain that polls only `getGesture()` otherwise reads
  NONE forever. The host stub + wodal need no such call (they return injected values).
- Injectable input (parity, **test-only**): for this tile, the **gesture enum**; for surface-2
  reads, **x/y/z + pitch/roll scalars** (pitch/roll are polled from CODAL, not derived). Both
  extend the button harness, and
  like it the injection path lives only on the cpp host + wodal builds - it is **excluded from
  the device firmware** (flash is premium; on device the port is CODAL-bound and `getGesture()`
  is real CODAL with no injection hook). No x/y/z->gesture derivation runs in the parity path.
- The injected gesture is a **held value**: a golden sets a gesture code and it persists until
  the script changes or clears it (mirroring CODAL's `getGesture()`, which holds the last
  gesture until a new one is detected). The recognized-duration nuance a real detector produces
  is a sim concern (see Sim UI), not the harness.
- Observable trace (format version 1): a sensor-fire line when the chosen gesture triggers
  (reuse the existing sensor-fire line; format pinned at implementation).

## Sim UI (apps/microbit-sim) - surface 3

**No dropdown** - every gesture emerges from physical sim inputs via the faithful wodal
detector, the way the real device works:

- **Globe** - a clickable/rotatable sphere with visible axes. Its **orientation** sets the
  gravity direction -> x/y/z/pitch/roll (surface 2) and the **tilt / face** gestures; its
  **movement** (wiggle/flick) produces dynamic acceleration -> **shake**.
- **Spring-back g-force slider** next to the globe - sets the acceleration **magnitude**;
  rests at **1G** and **snaps back to 1G when released**. Drag to **0G** -> **freefall**;
  releasing produces a snap-back (with overshoot) = an **impact** spike -> the `[impact]`
  gesture (slider range reaches ~8G so the higher g-levels are attainable). Magnitude is
  non-negative (direction is the globe's job).
- **Faithful wodal gesture detector** - a TS port of CODAL's thresholds (tilt/face, shake
  zero-crossing + damping, freefall, impact) turns globe + slider into the gesture the brain
  reads, so the sim matches the device (WYSIWYG). This is the **sim's interactive gesture
  model only** - **NOT** the parity path: goldens still inject the gesture enum via the
  harness (not the globe), so cpp and the golden path are unchanged. The detector gets its own
  wodal unit tests.
- `apps/microbit-sim` owns the UI; `wodal` owns the detector + the injectable input it drives.

Open (sim UI): shake-via-globe-movement ergonomics (a fallback "nudge" affordance if wiggling
is too fiddly); the per-gesture hard-coded recognized durations (shake ~momentary; freefall /
impact windows).

## Conformance

- The wodal microbit module is the oracle; the C++ port mirrors the level-compare (no
  detector to mirror - CODAL owns it). Per-gesture goldens driven by a **scripted
  gesture-enum schedule** - `(tick, code)` setpoints, the value held until the next setpoint
  (see Device and trace) - byte-matched both VMs.
- This is a **read** surfaced as a poll; no async-handle budget.

## Resolved decisions

All major design questions resolved (2026-06-17): poll `getGesture()` for parity (don't
reimplement the detector on the parity path - inject the gesture enum); tile name `gesture`;
every modifier is a **level** signal; default `shake`; gesture set = **shake + 4 tilt + 2 face
+ `freefall` + `impact`**, with conditional `[2g]/[3g]/[6g]/[8g]` g-force-level sub-modifiers
under `[impact]`; **surface 2 exposes `getGesture()` plus all value reads** (`getX/Y/Z`,
`getPitch/Roll`); value reads **surface-2-only**. Sim UI = globe (orientation + movement) +
spring-back g-force slider, **no dropdown**, driven by a **faithful wodal gesture detector**
(interactive only; parity stays enum-injection).

To confirm at implementation (not blocking): the concrete CODAL gesture-code numbers
(transcribed from the headers - the mapping itself is resolved: CODAL codes verbatim); how a
real multi-threshold CODAL impact reports through `getGesture()` on device (parity uses the
injected level); surface-2 x/y/z units (mg) + coordinate space; shake-via-globe-movement
ergonomics. (The per-gesture recognized durations are a sim-detector concern, listed under the
Sim UI open above, not a parity-harness question.)
