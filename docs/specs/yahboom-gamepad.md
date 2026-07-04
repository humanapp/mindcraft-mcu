# Spec: yahboom gamepad (GHBit)

The **Yahboom GHBit gamepad** (v1.2) is a micro:bit carrier handle: a thumb **stick**, four colored
buttons, and a rumble motor, all read/driven by the mounted micro:bit. In the robot pairing it is the
**send side**: its brain reads the controls and sends commands over radio; a chassis brain (e.g. the
Cutebot with the Movement arbitrator, `docs/specs/movement.md`) receives and drives. The handle has
**no radio of its own** - wireless is ordinary user-code radio on top (`docs/specs/radio.md`).

The control is named **stick** throughout (the convention of game controllers - "left stick" /
"right stick"); the vendor driver calls it the rocker.

The gamepad surface is pure **user-code** (examples channel): sensors over gpio reads plus user-code
radio. It depends only on platform capabilities that are already built - analog gpio read, radio
Buffer tiles, user-code conversions, Buffer as a first-class value with `Buffer.isBuffer`, and the
`ctx.getWhenResult()` accessor - so the example itself adds no VM or firmware change.

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

**Dependency: analog gpio read.** The stick axes read via `ctx.microbit.gpio.analogRead(pin)`
(`docs/specs/gpio.md` - host-fn 1071, both VMs, sim-injectable per pin like the digital reads).

## Tiles

```
[stick] [up?] [down?] [left?] [right?]         boolean level; bare: any direction active
[button] [red?] [green?] [blue?] [yellow?]     boolean level; bare: any button pressed
[stick position]                               inline; the position struct {x, y} (accessor tiles)
[decoded stick position]                       inline; decodes the WHEN-result packet -> position {x, y}; centered (0,0) when none
```

- **There is no separate packet tile.** The position IS the value; its wire form is produced by the
  registered **position -> Buffer conversion** (see the pairing section), so the broadcast rule is
  simply `WHEN always DO [radio send [stick position]]`. `[stick position]` is inline (it
  participates in expressions like `random` does, no gating) deliberately: the broadcast must
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
- **Stick press: deferred.** The hardware press (P8) exists and, in the vendor model, suppresses
  direction (the direction tiles read false while pressed), but a `[stick pressed]` tile is not in
  the first cut - add it when wanted, following the `[button]` pattern.
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
`<file>::<binding>` scheme Systems use), and referenced by both producers (the stick sensor's and
the decoder's return types) so the two speak one type. The type travels in the
compiled program's type table - a program-local struct, which both VMs already execute - so it
needs no target atom, no cpp mirror entry, and no platform ambient: projects that never import the
gamepad never see the type. Its accessor tiles (`x` / `y`) derive from the declared fields at
user-tile registration, the same auto-derivation pattern as parameter/modifier/output tiles (and
the same field-accessor mechanism the game-engine app drives with its `Vector2` registration - the
proven editor path, scoped here to a user-code type). Registration is register-if-absent by type
identity, so every importer shares one accessor tile set.

**The declaration and what each part exposes.** `position` is declared once as
`StructType({ name: "position", fields: { x: NumberType, y: NumberType }, accessors: true,
variables: true })` (full sketch below). The three exposures the gamepad relies on each come from
that declaration:

- **A tile-code type.** Being a `StructType` is what lifts `position` from a TS type into a
  first-class type in the brain editor: tiles may declare it as a `returnType` and take it as a
  typed argument, and it appears in the picker as a data type. Without the declaration it is only a
  TS type and no tile can speak it.
- **Accessor tiles** (`accessors: true`): one read-only accessor tile per field, derived from
  `fields` at registration - `[...][x]` / `[...][y]` - the only way to read a field off a position
  value in tile code.
- **A variable factory** (`variables: true`): the editor's "create variable of type position" tile
  (the same per-type variable-factory mechanism the game engine's ActorRef uses via
  `variableFactory: true`), so a brain can store a position in a variable and read it back later.

Storability is the deliberate half of that last flag - see "Buffer is a flow-through tile type;
Position is a storable one" below.

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

## Usage sketch (user code)

The four load-bearing declarations, as they sit in the gamepad module. Types are named by
**reference**: user types by their imported binding, core types by the ambient tokens
(`BufferType`, `NumberType`, ...). String names are the deprecated form, and canonical registry
names are lowercase (`"buffer"`, not `"Buffer"`) - one more reason refs are preferred.

```ts
// position.ts -- the type, declared once, identity-keyed by its exported symbol
import { StructType, type StructOf } from "mindcraft";

/** Stick position in game convention: x right-positive, y up-positive, both -100..100. */
export const Position = StructType({
  name: "position",                          // display name (tiles, picker)
  fields: { x: NumberType, y: NumberType },  // field order = storage order
  accessors: true,                           // derive the [x] / [y] accessor tiles
  variables: true,                           // offer "create variable of type position"
});
export type Position = StructOf<typeof Position>;

// stick-position.ts -- the inline producer
import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";
import { readStickX, readStickY } from "./stick-read";

export default Sensor({
  name: "stick position",
  inline: true,           // an inline value sensor: read in a value slot; takes no args
  returnType: Position,   // config ref required: the annotation alone cannot resolve a cross-module type
  onExecute(ctx: Context): Position {
    return Position({ x: readStickX(ctx), y: readStickY(ctx) });
  },
});

// position-to-buffer.ts -- the wire encode as an implicit conversion
import { Conversion } from "mindcraft";
import { Position } from "./position";
import { PACKET_MAGIC } from "./protocol"; // 0x47 ('G'), shared with the decoder

export default Conversion({
  id: "3xK9qA",   // stable opaque id, auto-minted + written back on first compile
  from: Position,
  to: BufferType, // ambient core-type token
  cost: 2,
  convert(pos: Position): Buffer {
    return Buffer.from([PACKET_MAGIC, pos.x + 100, pos.y + 100]);
  },
});

// decoded-stick-position.ts -- inline decoder: reads the received packet from the WHEN result
import { Sensor, type Context } from "mindcraft";
import { Position } from "./position";
import { PACKET_MAGIC } from "./protocol";

export default Sensor({
  name: "decoded stick position",
  inline: true,                    // an inline value sensor: takes no args (reads the enclosing WHEN's result)
  returnType: Position,            // config ref (cross-module type)
  consumesWhenResult: BufferType,  // reads the WHEN result as a Buffer; the editor offers + validates it accordingly
  onExecute(ctx: Context): Position {
    const wr = ctx.getWhenResult();                       // MindcraftValue
    if (Buffer.isBuffer(wr) && wr.length() >= 3 && wr.get(0) === PACKET_MAGIC) {
      return Position({ x: wr.get(1) - 100, y: wr.get(2) - 100 });
    }
    return Position({ x: 0, y: 0 });                      // centered: no valid packet
  },
});
```

- The declared binding is a **callable factory** (`Position({x, y})` constructs an instance) and the
  TS type derives from the fields config (`StructOf`) - one source of truth for the shape.
- `PACKET_MAGIC` is an ordinary shared module constant imported by encoder and decoder - the
  module-scope model at work.
- The decoder is **inline and total**: it always returns a valid Position, centered `(0,0)` when
  there is no valid packet. An inline sensor takes NO args (the accepted inline-sensor limitation),
  so it reads its buffer from the enclosing WHEN's captured value via `ctx.getWhenResult()`, narrowed
  with `Buffer.isBuffer` (both built platform capabilities). The Buffer surface is method-based -
  `length()` / `get(i)`, not `.length` / `b[i]`. It declares `consumesWhenResult: BufferType`, so
  the editor offers it under a Buffer-producing WHEN and flags a mismatch elsewhere - a non-blocking
  warning; the tile stays valid and returns the centered position.

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
  gamepad brain:  WHEN [always]                DO [radio send [stick position]]
  chassis brain:  WHEN [radio receive buffer]  DO [cutebot steer [decoded stick position][x] [decoded stick position][y]]
  ```

  - The gamepad encodes via a registered **implicit conversion** (position -> Buffer, below) and
    decodes with `decoded stick position` (an inline sensor - see below), which reads the received
    packet from the enclosing WHEN's result (`ctx.getWhenResult()`); the packet format is
    gamepad-owned. The decoder is inline in the `cutebot steer` slots, so no child WHEN is needed.
  - Radio transports opaque bytes via its Buffer tile forms (`docs/specs/radio.md`).
  - `cutebot steer` is the chassis-side numeric bridge: a Cutebot tile taking `x`/`y` number
    arguments (wired from the position's accessors) and feeding `Movement.drive(y)` /
    `Movement.turn(x)` scaled - the word-rated drive/turn tiles take no numeric params, so
    continuous steering needs this one numeric tile.
  - Packet loss or clock-skew gaps read as silent thinks on the chassis and are bridged by the
    Movement arbitrator's hold window; sustained silence decays to a stop.

**The position -> Buffer conversion (the encode).** The gamepad registers a **user-code implicit
conversion** from its position struct to Buffer in the core conversion registry - the same registry
the shipped game engine extends with its own conversions (ActorRef -> Vector2, Vector2 -> String),
here bound to a **compiled user function** rather than a host function (the one extension: a
conversion whose emission is an ordinary call to a linked user function; no VM change). The
compiler inserts it wherever a position fills a Buffer-expected slot, and the picker offers
`[stick position]` there as a conversion match. Consequences of "implicit": the conversion is
program-wide - a position is accepted by ANY Buffer slot (`i2c write`, a user tile's Buffer param),
always producing the state-packet bytes; that is the meaning of giving the position a canonical
byte form. Decoding is deliberately NOT a conversion - an arbitrary buffer is not a position; the
`decoded stick position` sensor validates (magic, length) and falls back to the centered position
instead.

**The state packet.** `[0x47 ('G'), x + 100, y + 100]` - three bytes; x/y are the normalized
-100..100 values offset to 0..200. The magic byte discriminates gamepad packets from all other
traffic on the group (the stage-1 string protocol coexists). Receivers validate length >= 3 and the
magic, and read only the bytes they know - a longer packet is not an error, which is the growth
path: a fourth byte (a buttons bitmask: B1..B4 + stick press) joins the packet when button state is
wanted on the wire, with no protocol rework and no version machinery.

**The decoder: `[decoded stick position]`.** An inline sensor that turns a received packet into a
`position` and returns it - the same struct type the stick produces locally, read downstream
through the accessor tiles `[decoded stick position][x]` / `[decoded stick position][y]`. As an
inline sensor it takes NO argument (the accepted inline-sensor limitation): it reads the packet
from the enclosing WHEN's captured value via `ctx.getWhenResult()`, narrowing with `Buffer.isBuffer`
- so under a `radio receive buffer` rule it decodes the received bytes with no explicit wiring. It
is **total**: a valid packet (magic + length ok) decodes to `{x, y}`; anything else (no packet,
wrong magic, too short) returns the **centered** position `(0, 0)`, never nil. Returning a valid
position in every case is what an inline sensor wants - a consumer like `cutebot steer` always gets
usable axes, and an unrecognized packet reads as "centered" (a stop). This does not conflict with
the hold window's "signal lost" handling: a think with **no** received packet does not fire the
receive WHEN at all, so the chassis sees a silent think (hold window), whereas the `(0,0)` fallback
only applies when the WHEN fired on some non-gamepad buffer. One value, one packet: the x/y pair is
atomic by construction, and both sides of the radio speak the same type. (Tile name provisional -
see Open questions.)

**Buffer is a flow-through tile type; Position is a storable one.** The packet travels from the
radio-receive tile through the WHEN result (or an explicit argument slot) to the decoder, and is
never stored - the editor offers no "create variable of type Buffer" tile and no Buffer literal
tile (a buffer is never typed by hand), even though user code can hold a buffer value. `Position` opts the other way: `variables: true` offers "create variable of type
position" (the editor's existing per-type variable-factory mechanism - the game engine's ActorRef
registers `variableFactory: true` the same way), so a brain can snapshot the stick
(`set dotPos [stick position]` - brain-variable deep-copy gives value semantics, which is right for
a position) and read it later via the accessors (`[dotPos][x]`). A stored user-typed variable
serializes its type in the brain document; a reload with the defining module removed degrades to
the missing-tile handling, never a crash. The two flags together show the point: storability is a
per-type declaration choice.

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
  dominance (press active -> direction tiles false; the `[stick pressed]` tile itself is deferred).
- Modifier OR-matching: a multi-modifier stick/button tile fires on each listed state and not on
  others; bare tiles fire on any.
- The position: injected raw values produce the exact centered/normalized `x`/`y` fields (including
  the rest-position snap to 0 and clamping), read through the accessor tiles in a real compiled
  brain; the local no-radio flow runs (`[stick position][x]` driving a display value).
- Buttons: each color maps to its pin, LOW-active, multi-color OR-matching.
- Stage-1 pairing: a gamepad brain + a chassis brain in one project round-trip a directional command
  over the sim radio ether into a movement influence.
- Stage-2 pairing: the full continuous-steering loop over the sim ether - injected raw stick values
  -> `[radio send [stick position]]` (the conversion encodes) -> radio Buffer send/receive ->
  `[decoded stick position]` reads the received packet from the WHEN result and returns the position
  -> accessors -> `cutebot steer` -> exact wheel writes. Plus decoder totality (a valid packet
  decodes; no packet / short / wrong magic -> the centered `(0,0)` position, never nil) and the
  packet-atomicity property (`[decoded stick position][x]` and `[decoded stick position][y]` read
  downstream always come from the same packet). Bare `[decoded stick position]` (no arg, no buffer in
  the WHEN result) also returns centered `(0,0)`.
- The conversion: the picker offers `[stick position]` in a Buffer-expected slot as a conversion
  match; the emitted conversion produces the exact state-packet bytes (trace-pinned); a second
  Buffer-expected consumer (e.g. `i2c write`) accepts a position through the same conversion - the
  program-wide reach, exercised, not assumed.
- The first-exercised paths are pinned with reaching tests. The game-engine app proves the editor
  half of the struct machinery (a registered struct type with derived accessor tiles; struct-typed
  results and parameters; struct values through rule variables) AND the app-extensible conversion
  registry (custom registrations, compiler-emitted). What is first-exercised here, each needing a
  reaching test: the USER-DECLARED struct type as a tile surface (declaration + symbol-identity
  keying + a tile `returnType` referencing it - the go/no-go probe); accessor tiles derived for a
  user-code type and offered in the picker; a USER-CODE conversion (a registered conversion bound to
  a compiled user function - declaration, bundle-derived registration, emission as a linked call);
  and the first example use of an inline sensor consuming the WHEN result via `ctx.getWhenResult()`
  narrowed with `Buffer.isBuffer` (both landed as platform prerequisites).

## Open questions

- **Deadzone width** - nominal ~50 counts (~10% of span); firm up from the measured rest-wobble
  band of the real handle (the rest/full-deflection constants are already measured and grounded
  above; per-unit variance means recalibration stays a named-consts edit). The vendor's 200..730
  state deadzone is far too wide for continuous steering.
- ~~**Stage-2 wire form.**~~ RESOLVED: a single state-packet Buffer (`0x47, x+100, y+100`) over the
  radio Buffer tile forms, gamepad-owned encode/decode, layers decoupled (see the pairing section).
  The magic-byte + length-tolerant read is the growth path for button state; no version machinery.
- **Decoder tile name** - `[decoded stick position]` is provisional; it avoids introducing "gamepad"
  or "state" into the tile vocabulary (both read as unclear new concepts), but the final name is
  unsettled.
- **`[stick pressed]` tile** - deferred from the first cut (the hardware press and its
  direction-suppression are described above); add following the `[button]` pattern when wanted.
- **Rumble surface** - momentary vs duration-modified actuator; settle when rumble is picked up.
