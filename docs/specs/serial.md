# Spec: serial / UART transport

An edge-connector **Device-API** transport primitive (no tile), for talking to a robot chassis that has
its **own onboard MCU** and exposes its API over a UART serial link (the ELECFREAKS XGO-Rider class).
Like `i2c`/`gpio` it is chassis-agnostic library plumbing; the robot's packet protocol is a **pure-TS
library** on top of the transport.

Designed in full here; **built when a serial-MCU robot becomes a target** - the XGO-Rider class is the
concrete consumer. No tile.

## The transport surface

A robot-MCU link is a request-response byte stream: the micro:bit writes a command packet and reads a
fixed-length response packet. The transport is three host-functions on a `serial` sub-interface:

- `microbit.serial.redirect(txPin, rxPin, baud)` - route the UART to the given edge pins at a baud rate.
  Sync; called once at init. The pins + baud are **arguments** (they vary by chassis - the XGO-Rider
  class defaults to TX P14 / RX P13 at 115200).
- `microbit.serial.writeBuffer(buffer)` - sync TX: enqueue the bytes to the UART transmit buffer.
- `await microbit.serial.readBuffer(length, timeoutMs) -> Buffer` - **async** read of `length` bytes
  from the background RX buffer (a runtime-allocated **managed** `Buffer`, like `i2c.readBuffer`), or
  fewer on timeout. See below.

The packet framing (header, length, command/address, checksum, tail), command assembly, and response
parsing are **pure TS on a `Buffer`** - a chassis library, not a platform concern.

## The read is ASYNC (awaited), not a blocking sync call

A response read **waits for the robot to answer** - the bytes arrive over the wire after a round-trip. A
synchronous host-function that waited would stall the **entire** single-entry VM for that round-trip
(the same anti-pattern the background sensor driver avoids for `getPulseUs`). So `readBuffer` is an
**awaited** host-function (op 41 `HOST_CALL_ASYNC`):

- It returns a handle; the calling fiber **parks** (fiber-only - other rules keep running). CODAL's
  interrupt-driven UART RX fills a background ring buffer; the host loop **resolves** the handle when
  `length` bytes are available, or when `timeoutMs` elapses (resolving with the bytes received so far -
  an empty/short `Buffer` if the robot is silent). Single-entry holds: the RX fill enqueues, the host
  loop drains/resolves, nothing re-enters the VM.
- **Why awaited, not a cached sync read** (the sonar model): serial is a **transactional**
  request-response - you await the response to *your specific* query - not a continuously-measured shared
  value, so there is nothing to cache. This is the first **awaited Device-API read** (existing awaits are
  actuators, e.g. `display.drawImage`).
- **Timeout is required.** The raw MakeCode drivers assume the robot always answers exactly N bytes; the
  awaited read MUST bound its wait so a missing/silent robot cannot park a fiber forever.

## Transactions must be serialized

A transaction is a write-then-read pair on the **shared** UART. Concurrent rules each running a
transaction would interleave and corrupt the protocol (one rule's read consumes another's response - the
request-response analog of overlapping ultrasonic pings). The chassis library (or the primitive) must
make a transaction **atomic** - a serial-busy lock, or funnelling all robot I/O through one path. State
the chosen mechanism when built.

## Simulator + parity

wodal models a simulated UART: **recorded TX** (the written buffers, like the I2C bus's recorded writes)
and **injectable RX** (a scripted response stream feeding the RX buffer). The awaited `readBuffer`
resolves at a **deterministic tick** derived from the injected response schedule (when `length` bytes
become available, or the timeout) - identical on both VMs - the same determinism approach as the
background sensor driver's completion. The injected RX is the device's received bytes; in a golden they
match by construction.

## Observable trace

- `port serial redirect <txPin> <rxPin> <baud>`
- `port serial write <buffer-hex>`
- `port serial read <length> <buffer-hex>` (the bytes the awaited read resolved with)

both VMs, additive, format-version pinned; reconcile `docs/specs/contracts/observable-trace.md`.

## CODAL capability coverage

- **Transport (the platform primitive):** redirect + writeBuffer + the awaited readBuffer over CODAL's
  interrupt-driven UART RX buffering.
- **Composable in pure TS (not platform):** the entire packet protocol - framing, checksum, command
  assembly, response parsing - a chassis library.
- **Designed-aware, not exposed:** delimiter reads (`readUntil`) - the fixed-length awaited read covers
  the request-response drivers; a delimiter variant is additive if a driver needs it. Async
  `onDataReceived` callbacks are **designed OUT** - they fight the single-entry rule; the awaited read +
  background buffer is the single-entry-clean form. Flow control (RTS/CTS) is not used by these robots.

## ABI ids

Assigned when built (append-only per the `microbit-context.md` field-order invariant): a `MicroBitField`
entry, a type-atom id, and the `redirect`/`writeBuffer`/`readBuffer` host-function ids - `TBD` until then.

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors it. A user-tile golden doing
  a write-then-awaited-read against an injected RX response byte-matches wodal<->cpp (the write + the
  resolved read cross the port + trace lines; the await resolves at the same tick both VMs).
- For the awaited read, the `maxHandles` budget is a runtime guard, never a pool size.
- The ambient `.d.ts` typechecks against the declared Device API.
