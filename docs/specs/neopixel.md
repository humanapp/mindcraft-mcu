# Spec: NeoPixel / WS2812 addressable LEDs

An edge-connector **Device-API** output primitive (no tile), for driving a strip of WS2812/NeoPixel
addressable RGB(W) LEDs on a GPIO pin. Like `i2c`/`gpio` it is the chassis-agnostic library plumbing a
per-chassis robot library (or a user program) consumes; the rich color/animation surface is a **pure-TS
library on top of a single native primitive**.

Designed in full here; **not currently built** - no surveyed chassis uses addressable LEDs (Cutebot
and the DFRobot Maqueen Plus drive RGB over I2C; the original micro:Maqueen uses simple GPIO on/off
LEDs), so there is no consumer yet. The design is captured so the capability is not silently omitted;
it is built when a chassis with addressable WS2812 LEDs becomes a target.

## The one platform primitive

Driving WS2812 LEDs needs exactly one thing the VM cannot do in bytecode: a **bit-banged send** that
clocks a byte buffer out a GPIO pin with cycle-accurate sub-microsecond timing. Everything else is pure
TS arithmetic on a `Buffer`.

- `microbit.sendNeoPixelBuffer(pin, buffer)` - synchronously clock `buffer` out `pin` as the WS2812
  one-wire waveform. **Pin-keyed** (the same addressing model as `gpio`/`i2c` and the sonar). `buffer`
  carries the per-LED color bytes; the call returns when the whole buffer is clocked out.

### Data model

- The buffer is **N LEDs x stride** bytes: stride 3 for RGB (byte order **GRB** for the common WS2812B,
  or RGB), stride 4 for RGBW.
- **Brightness, gamma, color packing, HSL, rainbow, shift/rotate, per-pixel set, bar-graph/matrix** are
  all done in **pure TS** on the buffer before the send - none of it is a platform concern. The library
  pre-applies brightness into the bytes; the primitive just ships them.

## Platform note: synchronous, interrupts-off (device only)

The WS2812 waveform is a single uninterruptible critical section - the device impl disables interrupts
for the whole send, because any interrupt mid-send corrupts the timing. So unlike the background sensor
driver (whose blocking is escapable via event-driven measurement), this blocking is **inherent**: it
**cannot** be backgrounded. It is, however, an **output** - nothing to cache, no lag, no parity-timing
puzzle.

- The interrupts-off window **scales with LED count** (~30 us/LED + a ~300 us reset): a few LEDs (robot
  headlights/underglow) is ~hundreds of us (display-update scale); a long strip (60+) is ~ms and also
  pauses the device's own timers for that window. Drive small strips; a long strip stalls the VM.
- The device impl wraps CODAL's WS2812 bit-bang (the nRF52 routine), the same way the ultrasonic wraps
  CODAL `getPulseUs`.

## Simulator

The simulator renders the strip: it reads the sent buffer (per-LED GRB(W) bytes) and draws N colored
pixels. The buffer is the whole observable - there is no real timing to model on the sim side.

## Observable trace

`port neopixel send <pin> <buffer-hex>` - the pin + the exact bytes sent, both VMs. The bit-bang timing
is a device-only hardware concern and does NOT appear in the trace; the observable is the buffer content
(mirrors `i2c write` / `display drawImage` - an output buffer crossing the port). Parity is the buffer +
pin, byte-for-byte.

## CODAL capability coverage

- **Platform primitive (the only one):** the synchronous bit-bang `sendNeoPixelBuffer(pin, buffer)`.
- **Composable in pure TS (not platform):** the entire color/animation surface - RGB/GRB/RGBW packing,
  brightness, gamma/easing, HSL, rainbow, bar-graph, matrix, shift/rotate, per-pixel and range set. A
  shared TS library (the MakeCode `neopixel` surface) reproduces verbatim on top of the one primitive.
- **400 kHz / alternate-chip timings:** the primitive targets the standard WS2812B ~800 kHz timing;
  other addressable-LED chips with different timing would need a parameterized or additional send.
  Designed-aware; not a current need.

## ABI ids

Assigned when built (append-only per the `microbit-context.md` field-order invariant): a `MicroBitField`
entry, a type-atom id, and the `sendNeoPixelBuffer` host-function id - `TBD` until then.

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors it. A user-tile golden
  sending a known buffer to a pin byte-matches wodal<->cpp (the buffer crosses the port + the trace
  line); the simulator renders the buffer.
- The ambient `.d.ts` typechecks against the declared Device API.
