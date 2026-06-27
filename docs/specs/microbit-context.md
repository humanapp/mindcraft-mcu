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
  effects = **awaited**. A surface-2 awaited host-function dispatches as op 41 `HOST_CALL_ASYNC`
  (e.g. `display.drawImage`); the surface-1 tile / brain-action form of the same effect dispatches
  as op 45 `HOST_ACTION_CALL_ASYNC`. Both return an awaited handle and share one display lease.
- ABI ids are append-only. Each member is implemented + tested on **both VMs**
  and declared in the ambient `.d.ts`.

## Current surface (2026-06-17)

From the ambient `.d.ts` + the `*Port` layer:

| `ctx.microbit.*` | Methods                                                              | `*Port`             | Notes |
| ---------------- | ------------------------------------------------------------------- | ------------------- | ----- |
| `display`        | `setPixelValue(x,y,brightness)`, `getPixelValue(x,y)`, `clear()`, `drawImage(image, duration?)` | `PixelDisplayPort`  | `drawImage` is the awaited (op 41) draw actuator: duration in seconds, default 1 s, explicit `0` = fire-and-forget, same lease as the surface-1 `draw image` tile. `scroll` is **tile-only** (a temporal actuator); not on this surface yet |
| `buttonA`        | `isPressed()`                                                       | `ButtonInputPort` (index 0) | |
| `buttonB`        | `isPressed()`                                                       | `ButtonInputPort` (index 1) | |
| `logo`           | `isPressed()`, `getThreshold()`/`setThreshold()`, `getValue()`/`setValue()` | `ButtonInputPort` (index 2) for `isPressed`; touch config separate | the `[logo]` tile hard-codes capacitance; surface 2 exposes the raw touch config (deliberate not-1:1) |
| `accelerometer`  | `getX/Y/Z()`, `getPitchRadians/RollRadians()`, `getPitch/Roll()`, `getGesture()` | `AccelerometerInputPort` | singleton struct, no discriminator; 8 sync reads; pitch/roll degrees derive-from-radians in the port (full detail in the section below) |

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

## `accelerometer` (wired both VMs 2026-06-18)

Surface-2 reads for the accelerometer peripheral (surface 1 = the gesture sensor tile,
`docs/specs/tiles/accelerometer-sensor.md`). Continuous values that are not rule triggers, so
they live here, not as tiles:

| `ctx.microbit.accelerometer.*` | Returns | Notes |
| ------------------------------ | ------- | ----- |
| `getX()` / `getY()` / `getZ()` | number (mg) | raw acceleration per axis |
| `getPitchRadians()` / `getRollRadians()` | number (radians) | the orientation primary; CODAL's on device, injected directly on the test-only path |
| `getPitch()` / `getRoll()`     | number (whole degrees) | DERIVED from radians via CODAL's exact f32 formula `(int)(360*rad/(2*PI))`, both VMs (not derived from x/y/z, not independently polled) |
| `getGesture()`                 | number (gesture code) | the current gesture enum (CODAL `ACCELEROMETER_EVT_*` codes verbatim); the same value the surface-1 `gesture` tile compares against |

- `AccelerometerInputPort` (`getGesture`, `getX/getY/getZ`, `getPitch/Roll` +
  `getPitchRadians/RollRadians`) on `DevicePorts`, bound to `uBit.accelerometer`. The reads
  **share the same poll** the gesture sensor tile consumes (one poll, both surfaces).
- Sync reads (instantaneous), per the stance.
- **Singleton struct - no discriminator** (unlike the buttons, which key one shared
  `isPressed` body by receiver): the `accelerometer` field resolves to one struct value and
  each of the 8 reads binds a distinct host-function body.
- **Not 1:1 with the tile:** TS user-code gets the raw values + pitch/roll + the current
  `getGesture()` code; the gesture *tile* (surface 1) adds the modifier-match + level
  semantics on top of `getGesture()`.
- **As-built ABI ids (append-only):** `MicroBitField.Accelerometer = 4` (appended LAST per the
  field-order invariant above), type-atom `1028`, host-function ids `1039-1046` (getX 1039,
  getY 1040, getZ 1041, getPitchRadians 1042, getRollRadians 1043, getPitch 1044, getRoll 1045,
  getGesture 1046).

## `i2c` (first edge-connector primitive; `writeBuffer` wired both VMs, `readBuffer` pending - build plan `generated-docs/i2c-primitive-impl-plan-2026-06-26.md`)

The external I2C bus on the edge connector (micro:bit v2 SDA/SCL, pins P19/P20), the plumbing a
Cutebot-style peripheral library consumes. **Surface-2 only - no tile** (an edge-connector
primitive). A singleton native-struct getter `ctx.microbit.i2c` (no discriminator, like
`accelerometer`), bound to CODAL `uBit.i2c` on device and to an injectable simulated bus in wodal.

| `ctx.microbit.i2c.*` | Returns | Notes |
| -------------------- | ------- | ----- |
| `writeBuffer(address, data)` | number (status: 0 = ok, nonzero = error) | write `data`'s bytes to the 7-bit `address` in one complete START/STOP transaction (CODAL `write(address, ptr, len, repeated=false)`). `data` is a `Buffer`. **The Cutebot-critical op** (motors/servos/lamps @ `0x10`). |
| `readBuffer(address, length)` | `Buffer` (`length` bytes; empty `Buffer` on error) | read `length` bytes from the 7-bit `address` (CODAL `read(address, ptr, len, repeated=false)`). Returns a runtime-allocated **managed** `Buffer`. |

- **Address convention: 7-bit**, matching pxt's `pins.i2cWriteBuffer(address, buf)` (the Cutebot
  library passes the 7-bit device address, e.g. `0x10`). CODAL's `I2C::write(uint16_t address, ...)`
  takes the 8-bit address (the 7-bit value shifted up one, R/W bit clear), so the device port impl
  shifts (`address << 1`); the surface and the trace keep the 7-bit address.
- **`Buffer` I/O:** `writeBuffer` reads the arg `Buffer`'s bytes (`bufferLength`/`bufferByteAt` in TS,
  `bufferBytes` in cpp); `readBuffer` produces a **managed** `Buffer` (runtime-allocated) - the first
  surface-2 host-function to return managed bytes (the `Buffer` workstream's managed-buffer path).
- **New `I2CPort` device-port** (`cpp/codal/device-port.h`): `write(address, bytes, len) -> status`,
  `read(address, buf, len) -> status`; device impl binds `uBit.i2c`, the host/test impl is an
  **injectable simulated bus** (a test registers per-address read-response bytes and inspects
  recorded writes - mirroring the gesture/button injection harness).
- **Trace:** `port i2c write <address> <hex>` and `port i2c read <address> <len> <hex>` (the bytes
  transferred), both VMs + `observable-trace.md`; parity is deterministic via injected read responses.
- **Sync** (instantaneous) host-functions per the stance; both VMs; append-only ids; ambient `.d.ts`
  mirror. **Sub-phased I1 (`writeBuffer`, Cutebot-critical) -> I2 (`readBuffer`, general).** Register
  helpers (write/read a device register) are composable in TS user code and intentionally NOT
  primitives here (Cutebot builds register bytes into the buffer it writes).
- **As-built ABI ids (I1, append-only):** `MicroBitField.I2C = 5` (appended LAST per the field-order
  invariant), type-atom `1029`, host-function id `1050` (`I2C.writeBuffer`). A zero-length write is
  a valid address-only transaction (an empty `port i2c write` byte list); there is no buffer-length
  cap (no CODAL limit to defend). `readBuffer` (I2) is not yet built.

## Roadmap (append as peripherals land)

Each peripheral adds its sub-interface here when its tile is added; source of capability is
the CODAL inventory (`generated-docs/codal-capability-inventory-2026-06-17.md`):

- onboard: `accelerometer` (getX/Y/Z, gesture), `thermometer` (getTemperature), `compass`
  (heading), display light level, microphone sound level, `radio` (send/receive).
- **edge-connector primitives** (surface-2 ONLY - no tile counterpart): **I2C (`writeBuffer` wired
  both VMs; `readBuffer` pending - see the `i2c` section above)**, GPIO
  (digital/analog/PWM/touch/pulse), the native NEC
  IR-receive primitive. These are the library plumbing a Cutebot-style peripheral library consumes;
  they live on this surface even though they have no tile. Cutebot needs all three (I2C @ 0x10 for
  motors/servos/lamps, GPIO for ultrasonic + line sensors, IR for the remote).

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 target mirrors it; user-tile
  goldens exercise the host-functions (e.g. `user-tile-button-display`), byte-matched across
  both VMs. The ambient `.d.ts` typechecks against the declared surface.
