# Spec: micro:bit I2C primitive (`ctx.microbit.i2c`)

The external I2C bus on the edge connector (micro:bit v2 SDA/SCL, pins P19/P20), the plumbing a
Cutebot-style peripheral library consumes. **Device API only - no tile** (an edge-connector
primitive); a sub-interface of the `ctx.microbit.*` device API (registry index:
`docs/specs/microbit-context.md`). A singleton native-struct getter `ctx.microbit.i2c` (no
discriminator, like `accelerometer`), bound to CODAL `uBit.i2c` on device and to an injectable
simulated bus in wodal.

| `ctx.microbit.i2c.*` | Returns | Notes |
| -------------------- | ------- | ----- |
| `writeBuffer(address, data)` | number (status: 0 = ok, nonzero = error) | write `data`'s bytes to the 7-bit `address` in one complete START/STOP transaction (CODAL `write(address, ptr, len, repeated=false)`). `data` is a `Buffer`. **The Cutebot-critical op** (motors/servos/lamps @ `0x10`). |
| `readBuffer(address, length)` | `Buffer` (`length` bytes; empty `Buffer` on error) | read `length` bytes from the 7-bit `address` (CODAL `read(address, ptr, len, repeated=false)`). Returns a runtime-allocated **managed** `Buffer`. |

- **Address convention: 7-bit**, matching pxt's `pins.i2cWriteBuffer(address, buf)` (the Cutebot
  library passes the 7-bit device address, e.g. `0x10`). CODAL's `I2C::write(uint16_t address, ...)`
  takes the 8-bit address (the 7-bit value shifted up one, R/W bit clear), so the device port impl
  shifts (`address << 1`); the surface and the trace keep the 7-bit address.
- **`Buffer` I/O:** `writeBuffer` reads the arg `Buffer`'s bytes (`bufferLength`/`bufferByteAt` in TS,
  `bufferBytes` in cpp); `readBuffer` produces a **managed** `Buffer` (runtime-allocated, via the
  `Buffer` value type's managed-buffer path).
- **New `I2CPort` device-port** (`cpp/codal/device-port.h`): `write(address, bytes, len) -> status`,
  `read(address, buf, len) -> status`; device impl binds `uBit.i2c`, the host/test impl is an
  **injectable simulated bus** (a test registers per-address read-response bytes and inspects
  recorded writes - mirroring the gesture/button injection harness).
- **Trace:** `port i2c write <address> <hex>` and `port i2c read <address> <len> <hex>` (the bytes
  transferred), both VMs + `observable-trace.md`; parity is deterministic via injected read responses.
- **Sync** (instantaneous) host-functions per the stance; both VMs; append-only ids; ambient `.d.ts`
  mirror. Register helpers (write/read a device register) are composable in TS user code and
  intentionally NOT primitives here (Cutebot builds register bytes into the buffer it writes).
- **ABI ids (append-only):** `MicroBitField.I2C = 5` (appended LAST per the field-order invariant),
  type-atom `1029`, host-function ids `1050` (`I2C.writeBuffer`) + `1051` (`I2C.readBuffer`). A
  zero-length write is a valid address-only transaction (an empty `port i2c write` byte list); there
  is no buffer-length cap (no CODAL limit to defend).
- **`readBuffer` semantics:** returns a runtime-allocated **managed `Buffer`** (cpp
  `ManagedHeap::allocBuffer`, read filled directly into the buffer; wodal `mkBufferValue`). A NACK /
  no-device / unrecognized-receiver read returns an **empty `Buffer`** (a heap-allocation failure
  faults the call, per the core buffer-builtin convention). The device impl shifts the 7-bit address
  `<<1` to CODAL's 8-bit form (port/sim/trace stay 7-bit). The simulated bus models a **fixed
  response per address** (set once, persists; `read` returns exactly `length` bytes - truncated if
  the stored response is longer, zero-padded if shorter, honoring the device "fill exactly `len`"
  contract); an address with no response is a no-device read.
- **Capability coverage (full CODAL I2C surface).** The shipped primitives are buffer `writeBuffer` /
  `readBuffer`, each a **complete START/STOP transaction** (`repeated = false`). The rest of CODAL's
  I2C surface is accounted for as follows:
  - **Composable in TS (designed out, not primitives):** single-byte write, `writeRegister`, and
    multi-byte register *writes* - all `writeBuffer(address, Buffer.from([reg, ...values]))`. A
    register *read* on a device that tolerates **write-stop-read** is `writeBuffer(address,[reg])` then
    `readBuffer(address, n)` (two complete transactions).
  - **DEFERRED capability (genuine gap, not just sugar): the `repeated`-start.** CODAL `write`/`read`
    take a `repeated` flag and `readRegister` defaults `repeated = true` (write the register, then a
    **repeated START with no intervening STOP**, then read). Our buffer ops are `repeated = false`, so
    a **true repeated-start register read is NOT expressible** - required by I2C devices that reject
    write-stop-read. **No consumer today** (Cutebot's I2C is write-only), so deferred; add a `repeated`
    option to `writeBuffer`/`readBuffer` (or a dedicated `readRegister`) when a device needs it.
  - **Designed out (no consumer):** the low-level bit-bang ops (`start`/`stop`/per-byte) - the surface
    is transaction-level only.

## Conformance

The wodal microbit module is the oracle; the C++ microbit-v2 target mirrors it; user-tile goldens
(`user-tile-i2c-write` / `user-tile-i2c-read`) exercise the host-functions, byte-matched across both
VMs under injected bus responses. The ambient `.d.ts` typechecks against the declared surface.
