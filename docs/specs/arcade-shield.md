# Spec: arcade shield

The Arcade display shield - an attachable expansion board for the micro:bit v2 carrying a small
color TFT screen (the MakeCode Arcade shield class: Elecfreaks Retro Arcade, Kittenbot newbit,
Game:bit, CodeCTRL, Kitronik Arcade) - across the surfaces it is exposed through: **Tiles** (shield
button sensor, shield draw actuators), the **Device API** (`ctx.microbit.arcadeShield`), and the
**Simulator** (the shield visual + the palette image editor). The cross-cutting `ctx.microbit.*`
conventions + registry index live in `docs/specs/microbit-context.md`; the display-family model this
spec builds on (target parameterization, the `Image` type, the editor descriptor seam) lives in
`docs/specs/display.md`.

The shield is the second consumer of the display spec's target-parameterization seam - the
"larger, palette-based Arcade screen" that spec anticipates - realized not as a new target but as a
**second, coexisting display on the same device**: the onboard 5x5 matrix and the shield screen are
distinct displays, each with its own draw surface. The `Image` type (shared type-atom `2048`) is
reused unchanged; only the pixel interpretation differs (palette index here, grayscale there).

ABI ids (append-only once assigned): `MicroBitField.ArcadeShield = TBD`, type-atom ids TBD,
host-function ids TBD, action ids TBD, tile keys `microbit-v2.shield-*`.

## The shield as a peripheral

- **Attachable and detectable.** The shield may or may not be connected. The device reports
  presence (on hardware, the shield's button shift-register reads non-zero; the same read
  identifies the screen variant and orientation). Presence is a first-class, injectable input.
- **Presence gating.** Shield sensors are presence-gated on the standard mechanism
  (`SensorConfig.presenceGated` + the `WHEN_END_PRESENT` capture): a shield-button rule does not
  fire while the shield is absent, and the picker gates the tiles on the device profile. Shield
  actuators and Device-API draw calls on an absent shield are **silent no-ops** (no error, no
  trace port line) - a brain written for the shield degrades to inert rather than faulting.
- **Screen variants.** The shield class spans two wire protocols behind one interface: direct
  ST7735/ILI9163C panels (160x128) and "smart" shields whose onboard MCU speaks a display
  protocol (160x120). The surface below is variant-agnostic: dimensions are **shield-reported**
  (`width()`/`height()`), and everything else is expressed against the framebuffer, not the wire.
  The direct ST7735 family is the primary profile; smart-shield transport is a designed capability
  (see Capability coverage).

## The framebuffer

- The shield screen is a **palette-indexed pixel grid** of shield-reported dimensions. A pixel
  value is a **palette index 0-15**; the palette maps indices to RGB colors. A value crossing the
  shield port narrows as: coordinates truncate to int16, palette indices truncate to uint8 then
  wrap mod 16.
- **The framebuffer is native-owned.** It lives behind the device port (in the wodal shield model /
  the C++ device layer), never as a VM value: bytecode issues draw commands and never holds
  pixels. On device the backing store is allocated outside the VM region (the VM's arena is not
  sized for it); it packs 4 bits per pixel internally - a device mechanic off the parity path.
- **Draw commands are instantaneous.** Every drawing operation is a sync host call that mutates
  the framebuffer and returns. There are no temporal members and **no lease on the shield
  display**: unlike the 5x5 matrix - where one glyph owns the whole display and arbitration needs
  a hold - the shield is a canvas that rules paint regions of. Content persists until overdrawn;
  there is no implicit clear. (A temporal member would adopt the display-family lease model
  unchanged; none is specified - see Open questions.)
- **Presentation.** The device presents the framebuffer to the physical panel (the SPI blit)
  once per host-loop drain when the framebuffer is dirty. Presentation cadence and transport are
  device-driver mechanics; the VM-visible contract is the command stream plus the per-present
  frame hash in the trace (see Conformance).
- **The default palette** is the 16-color Arcade palette (index: RGB):
  `0 #000000, 1 #ffffff, 2 #ff2121, 3 #ff93c4, 4 #ff8135, 5 #fff609, 6 #249ca3, 7 #78dc52,
  8 #003fad, 9 #87f2ff, 10 #8e2ec4, 11 #a4839f, 12 #5c406c, 13 #e5cdc4, 14 #91463d, 15 #000000`.
  Index 0 conventionally reads as background. Palette mutation is a designed capability (see
  Capability coverage).

## Tiles

### Identity

| Tile | Input / effect | Driver source | Tile key | Fn/Action id |
| ---- | -------------- | ------------- | -------- | ------------ |
| `shield button` | sensor: one of the shield's 7 buttons | button shift register poll | `microbit-v2.shield-button` | TBD |
| `shield draw image` | actuator: paste an `Image` at a position | framebuffer blit | `microbit-v2.shield-draw-image` | TBD |
| `shield show text` | actuator: draw text at a position | framebuffer text render | `microbit-v2.shield-show-text` | TBD |
| `shield clear` | actuator: fill the whole screen with a color | framebuffer fill | `microbit-v2.shield-clear` | TBD |

Core fields (shared):

| Field         | Value |
| ------------- | ----- |
| Kind          | `shield button` sensor; the rest actuators |
| Stance        | poll sensor; **sync actuators** (instantaneous framebuffer writes - no temporal quality, no await) |
| Composability | `shield button` inline (composable into conditions); actuators are `do` actions |
| Module        | microbit-v2 (`wendoo.microbit-v2`) |
| Label(s)      | "shield button", "shield draw image", "shield show text", "shield clear" |

The geometric primitives (line, rectangle, circle) are Device-API-only; they have no tile (see
Capability coverage - a tile-side shapes surface is designed out until a tile author needs one the
image tile cannot serve).

### Authoring

```
WHEN shield button [A] [pressed]
DO   shield draw image [happy-face] at x [10] y [20]

WHEN shield button [menu] [pressed]
DO   shield clear [color 0]
     shield show text ["snack time"] at x [8] y [56] [color 5]
```

`shield button` sits in a rule's `when` trigger (or inline in a condition); the draw actuators sit
in `do`.

### Arguments / modifiers

`shield button` (all optional - bare tile defaults to button A, pressed):

| Slot | Name | mod/param | Type | Required | Anonymous | Default |
| ---- | ---- | --------- | ---- | -------- | --------- | ------- |
| 0 | button | mod (choice: `up` / `down` / `left` / `right` / `a` / `b` / `menu`) | - | no | - | `a` |
| 1 | event | mod (choice, same event set as the onboard `button` sensor) | - | no | - | pressed |

`shield draw image`:

| Slot | Name | mod/param | Type | Required | Anonymous | Default |
| ---- | ---- | --------- | ---- | -------- | --------- | ------- |
| 0 | image | param | `Image` | no | yes | the target default image |
| 1 | x | param (named) | Number | no | no | 0 |
| 2 | y | param (named) | Number | no | no | 0 |

`shield show text`:

| Slot | Name | mod/param | Type | Required | Anonymous | Default |
| ---- | ---- | --------- | ---- | -------- | --------- | ------- |
| 0 | text | param | String | no | yes | the rule's WHEN-side result, else the target default string (same fallback as `display text`) |
| 1 | x | param (named) | Number | no | no | 0 |
| 2 | y | param (named) | Number | no | no | 0 |
| 3 | color | param (named) | Number (palette index) | no | no | 1 (white) |

`shield clear`:

| Slot | Name | mod/param | Type | Required | Anonymous | Default |
| ---- | ---- | --------- | ---- | -------- | --------- | ------- |
| 0 | color | param | Number (palette index) | no | yes | 0 |

Defaults live in the exec bodies, not the grammar; bodies resolve slots by `getSlotId`, never by
index.

### Behavior

- **`shield button`** - poll sensor. The device polls the shift-register state once per input
  cycle; the tile derives events from the polled press level with the **same derivation as the
  onboard `button` sensor** (`docs/specs/button.md`) - one shared derivation, seven button
  choices. Presence-gated: no shield, no fire.
- **Draw actuators** - sync, instantaneous. Each mutates the framebuffer and completes in the
  same instruction; the dispatching rule never parks. Concurrent draws from multiple rules
  compose by round order (later paints over earlier) - deterministic, no arbitration needed.
  - `shield draw image`: pastes the `Image` with its `(0,0)` at `(x, y)`, clipped to the
    framebuffer bounds; every image pixel is written (overwrite - transparency is the open
    design shared with `display.md`). Image pixel bytes are interpreted as palette indices
    (narrowed mod 16). An absent image draws the **target default image** (the shield's default
    art, analogous to the matrix smiley; its concrete art is target-defined and pinned by
    goldens).
  - `shield show text`: renders the resolved text at `(x, y)` in the given color using the
    target's built-in fixed-cell font, clipped to bounds; no wrapping, no scrolling (a scroll
    would be a temporal member - none specified). The text fallback chain matches
    `display text`.
  - `shield clear`: writes the color to every pixel.

### Timing / derivation

- `shield button`: the button.md press-level derivation, evaluated against VM tick time.
- Draw actuators: n/a (instantaneous sync).

### Device and trace

- **Device port:** an `ArcadeShieldPort` alongside the existing device ports - presence + button
  levels (reads), the draw-command family (effects), and the present hook. Bound to the wodal
  shield model in the sim and to the shield driver (CODAL SPI/ST7735 or the smart-shield
  transport) on device.
- **Injectable input:** presence (attach/detach) and per-button press levels - the same
  scripted schedule the parity harness drives and the sim UI fronts.
- **Observable trace:** one line per draw command crossing the port
  (`port shield clear <c>`, `port shield image <w> <h> <x> <y>`,
  `port shield text "<bytes>" <x> <y> <c>`, and the Device-API commands likewise), under the
  narrowing above, plus the per-present frame hash line (Conformance). Formats are pinned in
  `docs/specs/contracts/observable-trace.md`.

## Device API (`ctx.microbit.arcadeShield`)

All members are sync host-functions (instantaneous reads and framebuffer writes; the poll stance
for reads, no awaited member).

| `ctx.microbit.arcadeShield.*` | Returns | Notes |
| ----------------------------- | ------- | ----- |
| `isPresent()` | boolean | shield presence (the injectable input) |
| `width()` / `height()` | number | shield-reported framebuffer dimensions (160x128 direct / 160x120 smart) |
| `isPressed(button)` | boolean | raw pressed level for `"up" \| "down" \| "left" \| "right" \| "a" \| "b" \| "menu"`; the event derivation lives only in the sensor tile |
| `clear(color?)` | void | fill every pixel (default 0) |
| `setPixel(x, y, color)` | void | one pixel |
| `getPixel(x, y)` | number | palette index at `(x, y)`; out-of-bounds reads 0 |
| `drawLine(x0, y0, x1, y1, color)` | void | integer Bresenham line, clipped |
| `drawRect(x, y, w, h, color)` / `fillRect(...)` | void | outline / filled; covers `x..x+w-1`, clipped; non-positive `w`/`h` draws nothing |
| `drawCircle(cx, cy, r, color)` / `fillCircle(...)` | void | midpoint circle, clipped; `r < 0` draws nothing |
| `drawText(text, x, y, color?)` | void | the built-in font (default color 1); same rendering as the tile |
| `drawImage(image, x?, y?)` | void | paste-with-clip (default `(0,0)`); overwrite semantics |

- All draw commands clip silently to the framebuffer; drawing fully out of bounds is a no-op,
  never an error. All are silent no-ops while the shield is absent.
- Rasterization (the Bresenham line, the midpoint circle, the rect fill order, the font glyphs)
  is **pinned by the wodal implementation as the oracle** and byte-matched on the C++ side via
  the frame hash - the algorithms above are normative so both VMs rasterize identically.
- The `ArcadeShield` interface joins the target-bound ambient layer
  (`wendoo.microbit-v2.d.ts`) via the ambient-generation allow-list.

## Simulator (apps/microbit-sim)

- **The shield visual** renders when the shield is attached: the framebuffer as a canvas
  (palette-mapped, integer-scaled), with the 7 buttons as clickable controls around it (with a
  keyboard mapping for the D-pad and A/B). Button presses drive the same wodal injectable-input
  path the parity harness scripts.
- **Presence control:** an attach/detach toggle on the instance - the interactive front-end of
  the presence injectable. A detached shield hides the visual and un-gates nothing (sensors stop
  firing, draws no-op), exactly as on hardware.
- **Image editor:** the general palette pixel editor from `display.md`, driven by the shield's
  target descriptor - `renderPixel(value) = palette[value mod 16]` and an `editPalette` of the 16
  Arcade colors. The same `Image` struct the matrix editor authors; only the descriptor differs.
- `apps/microbit-sim` owns the UI; `wodal` owns the shield model and injectable mechanism.

## Driver capability coverage

Per the full-surface-design principle, the whole capability set of the shield class (the MakeCode
Arcade shield driver surface) is accounted for:

- **Shipped surface (this spec):** presence detection; the 7 buttons (poll + events); indexed
  framebuffer with the default palette; clear/fill; pixel set/get; line, rect, circle; text with
  the built-in font; image paste with clipping; the sim visual + editor descriptor.
- **Composable / designed out:**
  - *Screenshot* (read the framebuffer as an `Image`) - composable from `getPixel`.
  - *Scrolling / panning* (`scroll(dx, dy)`) - composable (redraw), and any built-in form would
    be a temporal-member design (Open questions).
  - *A tile-side shapes surface* (line/rect/circle tiles) - designed out; the image tile plus the
    Device API cover authoring, and a shapes tile family has no consumer.
  - *Additional fonts / font sizes* - designed out to one built-in font until a consumer needs
    more.
- **Designed, not built (genuine capabilities, no consumer yet):**
  - **`setPalette(colors)`** - replace the 16-color palette (the driver's 48-byte RGB table).
    Palette indirection means a palette swap recolors everything already drawn - a real
    capability (day/night, damage flash) with editor implications (the descriptor's palette is
    the default one).
  - **`setBrightness(level)`** - backlight/brightness control (PWM on direct panels, a protocol
    register on smart shields).
  - **Smart-shield transport** - the protocol MCU variant (160x120, needs the extra data-in
    line). Detection distinguishes it; the framebuffer surface above is unchanged; only the
    device-side transport differs.
  - **Vibration / rumble** - present on some boards in the class; would follow the shield port
    pattern.
- **Device-level interaction (flagged, resolved on hardware):** the shield's button-register
  latch line is one of the LED-matrix-shared pins. Whether the matrix and the shield operate
  concurrently, or the matrix must be disabled while the shield is attached, is a device-driver
  determination; `display.md`'s designed `enable()`/`disable()` is the lever if disabling is
  required. The VM-visible surfaces of both displays are unaffected either way.

## Conformance

- The wodal shield model is the oracle; the C++ port mirrors it. Two trace mechanisms pin parity:
  - **The command stream:** every draw command crossing the port emits its trace line (args under
    the pinned narrowing) - dispatch parity.
  - **The frame hash:** each present of a dirty framebuffer emits `port shield present <hash>`,
    a 32-bit FNV-1a over the framebuffer bytes - rasterization parity. A command-stream match
    with a hash mismatch localizes a rasterization divergence (Bresenham details, font glyphs,
    clip edges) that arg tracing alone cannot see.
- Golden fixtures: compiler-built brains exercising each tile and Device-API member
  (`shield-buttons`, `shield-draw`, `shield-shapes`, `shield-text`, `shield-absent` - the
  silent-no-op path with the shield detached) as `.mcprogram.bin` + `.ticks.trace`,
  byte-compared by the C++ parity test, with the scripted presence + button schedules alongside.
- No async members - no `maxHandles` impact.
- The ambient `.d.ts` typechecks against the declared Device API.

## Open questions

1. **Transparency / overlay draw.** Shared with `display.md` (representation + mode are an open
   dialog there). The shield is the first surface where it genuinely matters (a sprite over a
   background); the MakeCode driver keys transparency on source index 0, which conflicts with
   index 0 as a paintable color. Resolve once, in the display-family dialog, for both displays.
2. **Temporal members.** Whether any shield member with a temporal quality joins (a timed show, a
   text scroll, a frame-sequence animation) and adopts the display-family lease for the shield
   display, or whether composition with `pause` remains the answer.
3. **Smart-shield transport scope.** Whether the protocol-MCU variant ships with the first cut or
   the direct ST7735 family alone; affects only the device transport, not the surface.
4. **The matrix-shared latch pin.** Hardware determination (see Capability coverage); whether
   shield attachment implies matrix disable, and if so whether that is automatic or surfaced.
5. **Frame-hash pinning.** The hash line's exact format and the present-cadence guarantee (once
   per drain when dirty) to be pinned in `docs/specs/contracts/observable-trace.md`.
6. **Art at shield scale.** The 16-swatch pixel editor serves 5x5-to-icon-size art; authoring
   larger scenes (a Tamagotchi background) may want image import, sprite sheets, or the future
   asset-library concept (`display.md` open question 1). Nothing here blocks the surface; the
   editor is usable at any size.
