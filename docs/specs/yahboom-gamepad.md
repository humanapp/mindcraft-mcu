# Spec: yahboom gamepad (GHBit)

The **Yahboom GHBit gamepad** (v1.2) is a micro:bit carrier handle: a joystick/rocker, four colored
buttons, and a rumble motor, all read/driven by the mounted micro:bit. In the robot pairing it is the
**send side**: its brain reads the controls and sends commands over radio; a chassis brain (e.g. the
Cutebot with the Movement arbitrator, `docs/specs/movement.md`) receives and drives. The handle has
**no radio of its own** - wireless is ordinary user-code radio on top (`docs/specs/radio.md`).

The gamepad surface is pure **user-code** (examples channel): sensors over gpio reads plus user-code
radio. No VM or firmware change beyond the analog-read gpio primitive it depends on (below).

## Hardware surface (grounded in the vendor GHBit driver)

| Control                        | Mechanism                                         |
| ------------------------------ | ------------------------------------------------- |
| Joystick vertical (up/down)    | analog read pin 1, 0-1023 (up reads LOW)          |
| Joystick horizontal (left/right)| analog read pin 2, 0-1023 (right reads LOW)      |
| Joystick press                 | digital pin 8, pull-up, LOW = pressed             |
| Buttons B1-B4                  | digital pins 13/14/15/16, pull-up, LOW = pressed  |
| Rumble motor                   | PCA9685 channel 0 over i2c (full-duty on / off)   |

- Pin 1 is the VERTICAL axis and pin 2 the HORIZONTAL - the handle's physical mounting. (The vendor
  driver calls pin 1 "x"; this spec's outputs use game convention instead - see Rocker outputs.)
- Vendor direction model: thresholded single state - `x < 200` = up, `x > 730` = down, else `y < 200`
  = right, `y > 730` = left (deadzone 200..730); **press dominates direction** (a pressed stick
  reports press, not a direction). At most one direction is active at a time.
- Buttons are LOW-active (the same convention as the Cutebot line sensors).

**Dependency: analog gpio read.** The joystick axes require an analog pin read; the gpio Device-API
family (`docs/specs/microbit-context.md` registry) provides digital reads today - the analog read is
the gamepad's prerequisite primitive (both VMs, appended ids, injectable in the sim like the digital
reads).

## Tiles

```
[rocker] [up?] [down?] [left?] [right?]        boolean level; bare: any direction active
[button] [red?] [green?] [blue?] [yellow?]     boolean level; bare: any button pressed
[rocker pressed]                               boolean level; the stick click
```

- **Non-exclusive direction/color modifiers.** Each modifier may appear at most once, any subset
  together (`bag` of optional modifiers). The tile is true while the current state matches **any**
  listed modifier (`[rocker][up][left]` = up or left; the vendor state is single-valued, so multiple
  modifiers widen the match). Bare tile = any direction / any button - per the standard bare-tile
  posture.
- **Colors name the buttons**: red = B1, green = B2, blue = B3, yellow = B4.
- **Level signals, like buttons.** True while held; edge / one-shot behavior comes from composed
  filters (`docs/specs/filters.md`), not tile variants.
- **The stick click is its own tile** (`rocker pressed`), not a direction modifier - in the vendor
  model press suppresses direction, so while pressed the direction tiles read false.
- **Shared modifier vocabulary**: `modifier.direction.up/.down/.left/.right` (left/right are the SAME
  shared ids the Cutebot movement tiles use - a direction modifier is copy/paste-interchangeable
  across the two surfaces) and `modifier.color.red/.green/.blue/.yellow`.

## Rocker outputs: continuous x / y (sensor output tiles)

The `rocker` sensor declares two **output tiles** (`docs/specs/sensor-output-tiles.md`):

- `x` (number) and `y` (number) - the live stick position, **centered and normalized to -100..100**
  (re-centered on the rest position; clamped). The -100..100 range deliberately matches the movement
  influence range, so continuous steering maps arithmetic-free onto drive/turn magnitudes.
- **Axis convention: game convention, transformed IN the driver.** Output `x` is the HORIZONTAL
  axis (pin 2; right = +100, left = -100 - matching the movement convention where positive spin is
  rightward) and output `y` is the VERTICAL axis (pin 1; up = +100, down = -100). The full raw-to-
  game mapping (pin assignment, re-centering, sign, per-side scaling, deadzone, clamp) happens at
  the read site inside the rocker sensor; vendor coordinates never leave the driver, and every
  downstream consumer - output tiles, the radio protocol, the chassis mapping - sees game
  convention only. (The vendor driver's internal `x` is the vertical pin - a naming swap the driver
  absorbs, not exports.)
- **Grounded constants (measured on the real v1.2 handle; per-unit, kept as named consts for easy
  recalibration).** Both pots read LOW in the positive-convention direction, so one formula shape
  serves both axes: signed offset `d = rest - raw`, scaled by that side's own span (the spans are
  mildly asymmetric, so per-side scaling makes full deflection exactly +-100 both ways), deadzone-
  rescaled, clamped:
  - `y` (pin 1): rest 500; up raw 0 (span 500); down raw 1018 (span 518).
  - `x` (pin 2): rest 502; right raw 0 (span 502); left raw 1023 (span 521).
  - The stick spans essentially the full 0-1023 electrical range on this unit.
- **Deadzone: per-axis and rescaled.** The sticks jitter at low offset, so readings within the
  deadzone of the rest position are exactly 0. The deadzone is **rescaled, not a hard cutoff**: the
  live band maps `[deadzone..span] -> [0..100]` so the output rises smoothly from 0 at the deadzone
  edge (a hard cutoff would jump from 0 to the edge value - a lurch on a steering robot). Per-axis
  (the consumers map axes independently); nominal width ~10% of span, tuned from the measured rest
  jitter of the real handle. Jitter beyond the deadzone is filtered downstream by the Movement
  arbitrator's opt-in smoothing, not by the gamepad.
- Written every fire via `setOutput`; available downstream of a `rocker` tile in the rule hierarchy.
- The outputs are continuous readings, live regardless of which direction state (or press) is
  active.
- Raw 0-1023 reads stay available to power users on the Device API surface of the example.

## The radio pairing (two stages)

- **Stage 1 - directional commands.** The gamepad brain sends state strings (`"up"`, `"stop"`,
  `"red"`, ...) with the `radio send` tile when rocker/button rules fire; the chassis brain matches
  them with `radio receive string` rules driving the Movement tiles. Works end-to-end with today's
  tiles - both brains are buildable entirely in the editor.
- **Stage 2 - continuous steering.** The gamepad sends the rocker's `x`/`y` outputs; the chassis maps
  them onto movement influences (e.g. y -> drive, x -> turn). The pair-friendly wire form is the
  radio value-pair (a named number: `x`/`y`), which is Device-API-only on receive today - so stage 2
  is a pair of small user-code tiles (a "send steering" actuator packing x/y; a chassis sensor
  unpacking them), and it is the concrete consumer for the value-pair receive tile noted as a future
  radio enhancement in `docs/specs/radio.md`.

## Rumble (designed, deferred)

The rumble motor is PCA9685 channel 0 over i2c (on = full duty, off = zero). Supporting it is a pure
user-code actuator (`i2c.writeBuffer`, the same path as the Cutebot motors) - no new primitive. Out
of the first cut by scope; the natural surface is a `[rumble]` actuator tile (momentary or
duration-modified) added when wanted.

## Out of scope

- The GHBit driver's other Yahboom kit devices (steppers, servos, ultrasonic, music) - not part of
  the gamepad.
- The v1/v2 handle's NeoPixel strip - the v1.2 hardware in use has none.

## Conformance

Headless compile-and-run examples (the line-sensor/movement test pattern), with injected analog/
digital pin values:

- Direction states from injected raw x/y: each vendor threshold band, the deadzone, and press
  dominance (press active -> direction tiles false, `rocker pressed` true).
- Modifier OR-matching: a multi-modifier rocker/button tile fires on each listed state and not on
  others; bare tiles fire on any.
- Output tiles: injected raw values produce the exact centered/normalized x/y (including the
  rest-position snap to 0 and clamping); the outputs are offered downstream of the rocker tile.
- Buttons: each color maps to its pin, LOW-active, multi-color OR-matching.
- Stage-1 pairing: a gamepad brain + a chassis brain in one project round-trip a directional command
  over the sim radio ether into a movement influence.

## Open questions

- **Deadzone width** - nominal ~50 counts (~10% of span); firm up from the measured rest-wobble
  band of the real handle (the rest/full-deflection constants are already measured and grounded
  above; per-unit variance means recalibration stays a named-consts edit). The vendor's 200..730
  state deadzone is far too wide for continuous steering.
- **Stage-2 wire form** - value-pairs via user-code tiles now, migrating to the value-pair receive
  tile when that radio enhancement lands.
- **Rumble surface** - momentary vs duration-modified actuator; settle when rumble is picked up.
