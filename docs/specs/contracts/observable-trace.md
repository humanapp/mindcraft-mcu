# Target Observable-Trace Contract

The observable trace is a deterministic, line-oriented, ASCII record of a brain's
externally visible effects across a tick schedule. The TypeScript device runtime
(`packages/wodal`) generates the committed golden trace; the C++ VM
(`cpp/test/trace-parity.test.cpp`) renders its own trace for the same program and
schedule and byte-compares. This file is the cross-VM contract for what the trace
records; the line grammar itself is defined and versioned in
`packages/wodal/src/targets/microbit-v2/mindcraft/observable-trace.ts`
(`OBSERVABLE_TRACE_FORMAT_VERSION`) and mirrored by
`cpp/hostkit/observable-trace.h`.

This is a target-layer contract, not the core bytecode contract: it does not
change `vm-contract.md`.

## Recorded effects

- `tick <ordinal> time <bits> dt <bits>` - one think boundary. Numbers render as
  IEEE-754 bit patterns (profile precision), never decimal.
- `action <id> site <cs> args <argc> <vals> result <val>` - a synchronous
  host-action call. Arguments are recorded as the VM passed them (pre-conversion).
- `action <id> site <cs> args <argc> <vals> async` - an asynchronous host-action
  dispatch (no result; the handle settles later).
- `port display set-pixel <xBits> <yBits> <brightnessBits>` - one pixel write that
  crossed the display device port, recorded with the post-conversion value (see
  below).
- `port display scroll "<bytes>"` - one scroll request crossing the port.
- `port display draw <width> <height> <hex>` - one image-draw paste crossing the
  display port. `<width>` and `<height>` are the clipped frame dimensions in
  minimal lowercase hex (at most the display size); `<hex>` is the clipped frame's
  brightness bytes, row-major, two lowercase hex digits per byte with no
  separators (empty for a zero-size frame). A draw silently dropped by the display
  lease writes nothing and emits no such line.
- `port i2c write <address> <hex>` - one buffer write crossing the I2C device
  port. `<address>` is the 7-bit device address in minimal lowercase hex; `<hex>`
  is the bytes written, in transmission order, two lowercase hex digits per byte
  with no separators (empty for a zero-length write).
- `fault <fiberId> <errorCode>` - a fiber fault.

Host-action ids and call-site ids render as minimal lowercase hex.

A host-action argument that is an `Image` (or any non-native struct) renders in
the `action ... <vals>` list as `struct <fieldCount> <value>...`: the field count
in minimal lowercase hex followed by one value token per field slot, in slot
order. A `Buffer`-typed field renders as `buffer <hex>` (two lowercase hex digits
per byte). A `List` argument renders as `list <count> <value>...`: the element
count in minimal lowercase hex followed by one value token per element, in order
(empty for an empty list); `draw image`'s image argument is a `List<Image>`, so it
renders this way. These value-token kinds are additive in format version 1;
native-backed struct arguments do not render. The line grammar is defined and
versioned in
`packages/wodal/src/targets/microbit-v2/mindcraft/observable-trace.ts` and mirrored
by `cpp/hostkit/observable-trace.cpp`.

## Port-crossing numeric conversion (pinned)

A brain computes in the profile's number type (microbit-v2 is f32), but the
micro:bit display is driven by CODAL `Image::setPixelValue(int16_t x, int16_t y,
uint8_t value)`. Both VMs narrow the set-pixel arguments to those CODAL parameter
types and let the device apply CODAL's range check, so the observable trace is
identical on both, including for fractional or out-of-range inputs:

- Coordinates (x, y): non-finite values become 0; finite values truncate toward
  zero and narrow to int16. Every call crosses the port and emits a `port display
  set-pixel` line with the narrowed coordinate. The device stores the pixel only
  when the coordinate is inside the matrix (`0 <= n < dimension`, dimension 5 on
  micro:bit v2); CODAL `Image::setPixelValue` drops a coordinate outside it.
- Brightness: non-finite values become 0; finite values truncate toward zero and
  narrow to uint8 (CODAL stores the uint8 with no clamp, so `300` becomes `44`).
- The `port display set-pixel` line records the post-narrowing `(x, y,
  brightness)`. The preceding `action` line records the raw, pre-narrowing
  arguments.

Integer coordinates inside the matrix narrow as the identity, so goldens authored
with such coordinates are unaffected by this rule.

The reference implementations are
`packages/wodal/src/targets/microbit-v2/mindcraft/actions/display-pixel-conversion.ts`
and `cpp/targets/microbit-v2/abi/host-binding-conversions.h`; the
`pixel-conversion` golden exercises a fractional coordinate (truncates), an
out-of-matrix coordinate (crosses but stores nothing), an over-bright value
(wraps), and a fractional brightness (truncates).
