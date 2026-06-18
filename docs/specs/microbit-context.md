# Spec: micro:bit Context surface (TS user-code device API)

Status: living registry. The authoritative definition of `ctx.microbit.*` - the lower-level
device API exposed to TypeScript user code. This is **surface 2** of the two-surface model
(surface 1 = the brain tile language, specs in `docs/specs/tiles/`). It is **one
cross-cutting interface** that grows incrementally: each peripheral added to the tile
language appends its sub-interface here. It is not a tile spec and does not follow the tile
template.

## What this is (and isn't)

- A host-function API bound to CODAL `uBit` (in `cpp/targets/microbit-v2/source/main.cpp`),
  shaped like the device `*Port` layer (`cpp/codal/device-port.h`). It is **not 1:1 with the
  tiles** - it tracks the device/port shape, not tile semantics. Example: `buttonA.isPressed()`
  is the raw pressed level; the click/hold/double-click derivation lives only in the button
  *sensor tile*, not here.
- The TS-author-facing type surface is the ambient
  `packages/wodal/ambient/mindcraft.microbit-v2.d.ts` (the `Context.microbit: MicroBit`
  interface). **This spec is the design intent; that `.d.ts` is its maintained mirror** -
  keep them in lockstep.
- **Reads share the underlying poll with the tiles:** one poll per input, consumed by both
  the tile derivation and the host-function. Do not duplicate the read.

## Conventions (per peripheral)

- `ctx.microbit.<peripheral>` is a native-struct getter (the `Struct(typeId,
  discriminator)` rep + `native-struct-bindings.h`); its methods are host-functions over a
  `DevicePort`, bound to `uBit` on device and to the wodal sim model.
- Stance (same as the tiles): instantaneous reads/writes = **sync** host-functions; temporal
  effects = **awaited** (op 45).
- ABI ids are append-only. Each member is implemented + tested on **both VMs**
  and declared in the ambient `.d.ts`.

## Current surface (2026-06-17)

From the ambient `.d.ts` + the `*Port` layer:

| `ctx.microbit.*` | Methods                                                              | `*Port`             | Notes |
| ---------------- | ------------------------------------------------------------------- | ------------------- | ----- |
| `display`        | `setPixelValue(x,y,brightness)`, `getPixelValue(x,y)`, `clear()`   | `PixelDisplayPort`  | `scroll` is **tile-only** (a temporal actuator); not on this surface yet |
| `buttonA`        | `isPressed()`                                                       | `ButtonInputPort` (index 0) | |
| `buttonB`        | `isPressed()`                                                       | `ButtonInputPort` (index 1) | |
| `logo`           | `isPressed()`, `getThreshold()`/`setThreshold()`, `getValue()`/`setValue()` | `ButtonInputPort` (index 2) for `isPressed`; touch config separate | the `[logo]` tile hard-codes capacitance; surface 2 exposes the raw touch config (deliberate not-1:1) |

**Wired both VMs (2026-06-17):** `buttonA`/`buttonB`/`logo` `isPressed()`. The C++
`microBitFieldGetter` previously resolved only `display`/`buttonA`, so `buttonB`/`logo` produced
nil receivers on device; it now resolves all three. `Button.isPressed` (1027) and
`TouchButton.isPressed` (1028) share one C++ body keyed by the receiver discriminator. The
`isPressed()` reads share the same per-input poll the button *sensor tiles* consume: in C++
both surfaces read `ButtonInputPort::isPressed(index)`; in wodal both read the same `Button`/
`TouchButton` device objects.

**No `buttonAB` on this surface:** the `[A+B]` brain *tile* (surface 1) exists because button
sensors are non-composable, but TS user code can read `buttonA` and `buttonB` independently and
`&&` them, so the composite is not exposed here.

**Invariant (native-struct field order):** the compiler keys `STRUCT_GET_FIELD` by a field's
*position* in the registered fields list, so the wodal `MicroBit` field order and the C++
`MicroBitField` enum values must stay equal (position == id). Append a new `ctx.microbit` field
last, at the next free id.

**Remaining gap:**
- `display.scroll` is tile-only; expose it here as an awaited `display.scroll()` only if a
  TS-user-code consumer wants it (no consumer today).

## Proposed: `accelerometer` (DRAFT 2026-06-17, not yet wired)

Surface-2 reads for the accelerometer peripheral (surface 1 = the gesture sensor tile,
`docs/specs/tiles/accelerometer-sensor.md`). Continuous values that are not rule triggers, so
they live here, not as tiles:

| `ctx.microbit.accelerometer.*` | Returns | Notes |
| ------------------------------ | ------- | ----- |
| `getX()` / `getY()` / `getZ()` | number (mg) | raw acceleration per axis |
| `getPitch()` / `getRoll()`     | number (degrees; exact range per CODAL) | CODAL native `getPitch`/`getRoll`, polled like x/y/z (not derived); injected as scalars on the test-only path |
| `getGesture()`                 | number (gesture code) | the current gesture enum; the same value the surface-1 `gesture` tile compares against |

- New `AccelerometerInputPort` (`getX/getY/getZ`, `getGesture`, ...) on `DevicePorts`, bound
  to `uBit.accelerometer`. The reads **share the same poll** the gesture sensor tile consumes
  (one poll, both surfaces).
- Sync reads (instantaneous), per the stance.
- **Not 1:1 with the tile:** TS user-code gets the raw values + pitch/roll + the current
  `getGesture()` code; the gesture *tile* (surface 1) adds the modifier-match + level
  semantics on top of `getGesture()`. (`getGesture()` is exposed - resolved 2026-06-17.)
- **Append `accelerometer` LAST** at the next free `MicroBitField` id, per the field-order
  invariant above. ids/values pinned at implementation (append-only); coordinate space + units must
  match the tile spec.

## Roadmap (append as peripherals land)

Each peripheral adds its sub-interface here when its tile is added; source of capability is
the CODAL inventory (`generated-docs/codal-capability-inventory-2026-06-17.md`):

- onboard: `accelerometer` (getX/Y/Z, gesture), `thermometer` (getTemperature), `compass`
  (heading), display light level, microphone sound level, `radio` (send/receive).
- **edge-connector primitives** (surface-2 ONLY - no tile counterpart): GPIO (digital/analog/
  PWM/touch/pulse), I2C (read/write register), the native NEC IR-receive primitive. These are
  the library plumbing a Cutebot-style peripheral library consumes; they live on this surface even though
  they have no tile.

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 target mirrors it; user-tile
  goldens exercise the host-functions (e.g. `user-tile-button-display`), byte-matched across
  both VMs. The ambient `.d.ts` typechecks against the declared surface.
