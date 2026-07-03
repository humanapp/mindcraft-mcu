# Spec: yahboom gamepad (GHBit)

The **Yahboom GHBit gamepad** (v1.2) is a micro:bit carrier handle: a thumb **stick**, four colored
buttons, and a rumble motor, all read/driven by the mounted micro:bit. In the robot pairing it is the
**send side**: its brain reads the controls and sends commands over radio; a chassis brain (e.g. the
Cutebot with the Movement arbitrator, `docs/specs/movement.md`) receives and drives. The handle has
**no radio of its own** - wireless is ordinary user-code radio on top (`docs/specs/radio.md`).

The control is named **stick** throughout (the convention of game controllers - "left stick" /
"right stick"); the vendor driver calls it the rocker.

The gamepad surface is pure **user-code** (examples channel): sensors over gpio reads plus user-code
radio. No VM or firmware change beyond the analog-read gpio primitive it depends on (below).

## Hardware surface (grounded in the vendor GHBit driver)

| Control                       | Mechanism                                         |
| ----------------------------- | ------------------------------------------------- |
| Stick vertical (up/down)      | analog read pin 1, 0-1023 (up reads LOW)          |
| Stick horizontal (left/right) | analog read pin 2, 0-1023 (right reads LOW)       |
| Stick press                   | digital pin 8, pull-up, LOW = pressed             |
| Buttons B1-B4                 | digital pins 13/14/15/16, pull-up, LOW = pressed  |
| Rumble motor                  | PCA9685 channel 0 over i2c (full-duty on / off)   |

- Pin 1 is the VERTICAL axis and pin 2 the HORIZONTAL - the handle's physical mounting. (The vendor
  driver calls pin 1 "x"; this spec uses game convention instead - see Stick position.)
- Vendor direction model: thresholded single state - `x < 200` = up, `x > 730` = down, else `y < 200`
  = right, `y > 730` = left (deadzone 200..730); **press dominates direction** (a pressed stick
  reports press, not a direction). At most one direction is active at a time.
- Buttons are LOW-active (the same convention as the Cutebot line sensors).

**Dependency: analog gpio read.** The stick axes require an analog pin read; the gpio Device-API
family (`docs/specs/microbit-context.md` registry) provides digital reads today - the analog read is
the gamepad's prerequisite primitive (both VMs, appended ids, injectable in the sim like the digital
reads).

## Tiles

```
[stick] [up?] [down?] [left?] [right?]         boolean level; bare: any direction active
[button] [red?] [green?] [blue?] [yellow?]     boolean level; bare: any button pressed
[stick pressed]                                boolean level; the stick click
[stick position]                               inline; the position struct {x, y} (accessor tiles)
[stick packet]                                 inline; the state-packet Buffer (the wire form)
[gamepad state <buffer>]                       decoder sensor; `position` struct output
```

- **`[stick packet]` is inline** (it participates in expressions like `random` does, no gating)
  deliberately: the broadcast rule is `WHEN always DO [radio send [stick packet]]`, and it must
  encode the **centered** stick too - the chassis distinguishes "centered" from "signal lost" (the
  hold window keys on the latter). A stick-gated source would only broadcast on deflection.
- **Non-exclusive direction/color modifiers.** Each modifier may appear at most once, any subset
  together (`bag` of optional modifiers). The tile is true while the current state matches **any**
  listed modifier (`[stick][up][left]` = up or left; the vendor state is single-valued, so multiple
  modifiers widen the match). Bare tile = any direction / any button - per the standard bare-tile
  posture.
- **Colors name the buttons**: red = B1, green = B2, blue = B3, yellow = B4.
- **Level signals, like buttons.** True while held; edge / one-shot behavior comes from composed
  filters (`docs/specs/filters.md`), not tile variants.
- **The stick click is its own tile** (`stick pressed`), not a direction modifier - in the vendor
  model press suppresses direction, so while pressed the direction tiles read false.
- **Shared modifier vocabulary**: `modifier.direction.up/.down/.left/.right` (left/right are the SAME
  shared ids the Cutebot movement tiles use - a direction modifier is copy/paste-interchangeable
  across the two surfaces) and `modifier.color.red/.green/.blue/.yellow`.

## Stick position: a `position` struct value

The continuous stick position is a **`position` struct** `{ x, y }`, produced by the inline
`[stick position]` sensor and read through the editor's struct **accessor tiles** -
`[stick position][x]` / `[stick position][y]`. Because the sensor is inline and ungated, the
position is usable in any expression of any rule - radio is not involved: a local game can move a
dot around the micro:bit display from the stick alone
(`WHEN always DO [set dot x [stick position][x]] ...` - chase games, pixel-collecting games). There
are no separate x/y output tiles; the struct + accessors are the one way to read the stick.

**`position` is a user-declared struct type in the gamepad's own TS code** - not a platform type.
It is declared once in the gamepad module, keyed by its exported symbol identity (the same
`<file>::<binding>` scheme Systems use), and referenced by both producers (the stick sensor's
return type and the decoder's output type) so the two speak one type. The type travels in the
compiled program's type table - a program-local struct, which both VMs already execute - so it
needs no target atom, no cpp mirror entry, and no platform ambient: projects that never import the
gamepad never see the type. Its accessor tiles (`x` / `y`) derive from the declared fields at
user-tile registration, the same auto-derivation pattern as parameter/modifier/output tiles (and
the same field-accessor mechanism the game-engine app drives with its `Vector2` registration - the
proven editor path, scoped here to a user-code type). Registration is register-if-absent by type
identity, so every importer shares one accessor tile set.

- `x` and `y` are the live stick position, **centered and normalized to -100..100** (re-centered on
  the rest position; clamped). The -100..100 range deliberately matches the movement influence
  range, so continuous steering maps arithmetic-free onto drive/turn magnitudes.
- **Axis convention: game convention, transformed IN the driver.** `x` is the HORIZONTAL axis
  (pin 2; right = +100, left = -100 - matching the movement convention where positive spin is
  rightward) and `y` is the VERTICAL axis (pin 1; up = +100, down = -100). The full raw-to-game
  mapping (pin assignment, re-centering, sign, per-side scaling, deadzone, clamp) happens at the
  read site inside the stick sensors; vendor coordinates never leave the driver, and every
  downstream consumer - the position value, the radio protocol, the chassis mapping - sees game
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
- The position is a continuous reading, live regardless of which direction state (or press) is
  active; each evaluation of `[stick position]` samples the pins and builds a fresh struct.
- Raw 0-1023 reads stay available to power users on the Device API surface of the example.

## The radio pairing (two stages)

- **Stage 1 - directional commands.** The gamepad brain sends state strings (`"up"`, `"stop"`,
  `"red"`, ...) with the `radio send` tile when stick/button rules fire; the chassis brain matches
  them with `radio receive string` rules driving the Movement tiles. Works end-to-end with today's
  tiles - both brains are buildable entirely in the editor.
- **Stage 2 - continuous steering (the state packet).** The x/y pair must arrive **atomically** -
  the receive path delivers one packet per think, so two separate sends would interleave a stale
  axis with a fresh one. The pair therefore travels as ONE **state-packet Buffer**, and the layers
  stay decoupled - the gamepad knows nothing of radio, radio knows nothing of gamepads, and the app
  wires them:

  ```
  gamepad brain:  WHEN [always]                  DO [radio send [stick packet]]
  chassis brain:  WHEN [radio receive buffer]
                    WHEN [gamepad state [received value]]
                      DO [cutebot steer [position][x] [position][y]]
  ```

  - The gamepad encodes (`stick packet`, an inline sensor - see Tiles) and decodes
    (`gamepad state`, a Buffer-argument sensor - see below); the packet format is gamepad-owned.
  - Radio transports opaque bytes via its Buffer tile forms (`docs/specs/radio.md`).
  - `cutebot steer` is the chassis-side numeric bridge: a Cutebot tile taking `x`/`y` number
    arguments (wired from the position's accessors) and feeding `Movement.drive(y)` /
    `Movement.turn(x)` scaled - the word-rated drive/turn tiles take no numeric params, so
    continuous steering needs this one numeric tile.
  - Packet loss or clock-skew gaps read as silent thinks on the chassis and are bridged by the
    Movement arbitrator's hold window; sustained silence decays to a stop.

**The state packet.** `[0x47 ('G'), x + 100, y + 100]` - three bytes; x/y are the normalized
-100..100 values offset to 0..200. The magic byte discriminates gamepad packets from all other
traffic on the group (the stage-1 string protocol coexists). Receivers validate length >= 3 and the
magic, and read only the bytes they know - a longer packet is not an error, which is the growth
path: a fourth byte (a buttons bitmask: B1..B4 + stick press) joins the packet when button state is
wanted on the wire, with no protocol rework and no version machinery.

**The decoder: `[gamepad state <buffer>]`.** A sensor taking a Buffer **argument** (it does not
read radio itself). Presence-gated: nil when the argument is nil, too short, or fails the magic -
so as a child WHEN under the radio receive rule it fires exactly on valid gamepad packets. On a
match it decodes the packet into **one `position` output of the gamepad's position struct type**
(the same type the stick produces locally), read downstream through the accessor tiles -
`[position][x]` / `[position][y]`. One value, one packet: the pair is atomic by construction, and both sides of the
radio speak the same type. The decoder is named for the packet it decodes: when button state joins
the packet, its outputs grow without a rename.

**Buffer is a flow-through tile type.** The packet travels output-tile -> argument-slot inside the
rule hierarchy; it is never stored. Brain variables of type Buffer are deliberately not offered
(nothing needs packet storage); there is no Buffer literal tile (a buffer is never typed by hand).

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

- Direction states from injected raw values: each vendor threshold band, the deadzone, and press
  dominance (press active -> direction tiles false, `stick pressed` true).
- Modifier OR-matching: a multi-modifier stick/button tile fires on each listed state and not on
  others; bare tiles fire on any.
- The position: injected raw values produce the exact centered/normalized `x`/`y` fields (including
  the rest-position snap to 0 and clamping), read through the accessor tiles in a real compiled
  brain; the local no-radio flow runs (`[stick position][x]` driving a display value).
- Buttons: each color maps to its pin, LOW-active, multi-color OR-matching.
- Stage-1 pairing: a gamepad brain + a chassis brain in one project round-trip a directional command
  over the sim radio ether into a movement influence.
- Stage-2 pairing: the full continuous-steering loop over the sim ether - injected raw stick values
  -> `stick packet` encodes -> radio Buffer send/receive -> `gamepad state` decodes -> the
  `position` output -> accessors -> `cutebot steer` -> exact wheel writes. Plus the decoder
  negatives (nil / short / wrong magic -> presence-gated nil, no output write) and the
  packet-atomicity property (`[position][x]` and `[position][y]` read downstream always come from
  the same packet).
- The first-exercised paths are pinned with reaching tests. The game-engine app proves the editor
  half of the struct machinery (a registered struct type with derived accessor tiles; struct-typed
  results and parameters; struct values through rule variables), and the System substrate proves
  user-code TS shapes registering as program structs. What is first-exercised here, each needing a
  reaching test: the USER-DECLARED struct type as a tile surface (declaration + symbol-identity
  keying + a tile `returnType` referencing it - the go/no-go probe); accessor tiles derived for a
  user-code type and offered in the picker; a struct-typed OUTPUT tile; and the Buffer-typed
  output-into-argument-slot flow end to end.

## Open questions

- **Deadzone width** - nominal ~50 counts (~10% of span); firm up from the measured rest-wobble
  band of the real handle (the rest/full-deflection constants are already measured and grounded
  above; per-unit variance means recalibration stays a named-consts edit). The vendor's 200..730
  state deadzone is far too wide for continuous steering.
- ~~**Stage-2 wire form.**~~ RESOLVED: a single state-packet Buffer (`0x47, x+100, y+100`) over the
  radio Buffer tile forms, gamepad-owned encode/decode, layers decoupled (see the pairing section).
  The magic-byte + length-tolerant read is the growth path for button state; no version machinery.
- **Rumble surface** - momentary vs duration-modified actuator; settle when rumble is picked up.
