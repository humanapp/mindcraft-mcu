# Spec: micro:bit GPIO primitive (`ctx.microbit.gpio`)

Status: PROPOSED (second edge-connector primitive). Build plan:
`generated-docs/gpio-primitive-impl-plan-2026-06-26.md`.

The edge-connector GPIO pins (P0-P20), the plumbing a Cutebot-style library consumes for its line
sensors, gripper servos, and ultrasonic. **Device API only - no tile**; a sub-interface of the
`ctx.microbit.*` device API (registry index: `docs/specs/microbit-context.md`). A singleton
native-struct getter `ctx.microbit.gpio` (no discriminator, like `i2c`), bound to CODAL `uBit.io.P<n>`
on device (a pin-number -> `NRF52Pin` lookup) and to an injectable simulated pin model in wodal. A
**pin** is a **number 0-20** (matching pxt / the physical labels); an out-of-range pin is a no-op.
**Pins P3/P4/P6/P7/P9/P10 are shared with the LED display matrix** - using them as GPIO requires the
display disabled (`display.disable()`, a deferred display capability - see `docs/specs/display.md`);
Cutebot's pins do not overlap the matrix, so this is off the Cutebot path.

**The full GPIO capability surface is designed here; implementation is phased and any deferral is
marked, not omitted** (board features get a complete API design; Cutebot drives *priority*, not
*scope*). The micro:bit pin capability set is **digital I/O, pull, servo, analog/PWM, touch, and
pulse measurement**. Implementation phases: **G1** (digital/pull/servo, first), **G2** (ultrasonic
pulse - native), **G3** (analog/PWM - deferred), touch (deferred, via `TouchButton`).

## Digital I/O + pull + servo (G1 - implemented first; sync host-fns, mirrors I2C)

| `ctx.microbit.gpio.*` | Returns | CODAL | Notes |
| --------------------- | ------- | ----- | ----- |
| `digitalRead(pin)` | number (0/1) | `getDigitalValue()` | Cutebot line sensors (P13/P14) |
| `digitalWrite(pin, value)` | number (status) | `setDigitalValue(0/1)` | general output |
| `setPull(pin, mode)` | number (status) | `setPull(PullMode)` | `mode`: 0 none / 1 up / 2 down (a small enum); the line sensors set PullNone at init |
| `servoWrite(pin, angle)` | number (status) | `setServoValue(angle)` | Cutebot gripper servos (P1/P2); `angle` 0-180, standard 20 ms period |

- **Sim:** an injectable pin model (a test sets a pin's digital-read value and inspects recorded
  digital/servo writes + pull config) - mirrors the `I2CBus` injectable model.
- **Trace:** `port gpio digital-write <pin> <value>`, `port gpio digital-read <pin> <value>`,
  `port gpio set-pull <pin> <mode>`, `port gpio servo-write <pin> <angle>` (reads trace the returned
  value for parity), both VMs + `observable-trace.md`.

## Analog / PWM (DESIGNED; implementation DEFERRED - phase G3)

Part of the GPIO capability set, so designed now; implementation deferred (off the Cutebot critical
path - its sensors are digital). Crosses the **port numeric-typing seam** (the analog value narrows
f32 -> CODAL's range identically both VMs - the resolved 6j pattern: a port typed to the CODAL
signature, the device doing range/early-out, the narrowed value in the trace).

| `ctx.microbit.gpio.*` | Returns | CODAL | Notes |
| --------------------- | ------- | ----- | ----- |
| `analogRead(pin)` | number (0-1023) | `getAnalogValue()` | ADC read |
| `analogWrite(pin, value)` | number (status) | `setAnalogValue(0-1023)` | PWM duty cycle |
| `setAnalogPeriod(pin, periodMicros)` | number (status) | `setAnalogPeriodUs()` | PWM period (us) |
| `servoSetPulse(pin, pulseMicros)` | number (status) | `setServoPulseUs()` | explicit servo pulse width (the Cutebot gripper driver optionally calls it) |

- Deferred trace lines (land with the impl): `port gpio analog-read/analog-write/set-analog-period/
  servo-set-pulse <pin> <value>`.

## Touch pins (DESIGNED-direction; implementation DEFERRED, off the Cutebot path)

The touch-capable pins (v2: P0/P1/P2) surface through the **existing `TouchButton` type** - a
`touchPin(n): TouchButton` getter returning `Struct(TouchButton, pinN)`, reusing TouchButton's
`isPressed` / `getThreshold` / `setThreshold` / `getValue` / `setValue` over CODAL pin touch
(`isTouched`). The one new mechanism is a getter returning a native struct discriminated by a runtime
pin arg (today's getters are fixed-discriminator). See the build plan's "Future extensions". A raw
`isTouched(pin): number` is the simpler alternative if the config object is not wanted.

## Ultrasonic / pulse (G2 - native, design open)

The SR04 ultrasonic needs a 10 us trigger pulse + a microsecond echo-pulse measurement (CODAL
`getPulseUs`). The round-based VM cannot time microseconds in bytecode, so this is a **native C++
host-function**. **Design open (resolve at G2 prep, co-design with the native NEC IR-receive
primitive):** a general `pulseIn(pin, level, timeoutUs)` measurement + a native `waitMicros` for the
trigger (general, reusable, but exposes a blocking busy-wait), vs. an **atomic** triggered-pulse
primitive (`sonarPulse(trig, echo, triggerUs, timeoutUs) -> echoUs`) that does the whole SR04
trigger+measure in one native call (no inter-call VM jitter, no `waitMicros` primitive). Cutebot's
drive motors + lamps are I2C (done); G2 is the obstacle-distance sensor. **Confirmed against the
official driver** (ELECFREAKS pxt-cutebot `ultrasonic()`): `setPull(P8,None)` + `digitalWrite(P8,
0/1/0)` with `waitMicros(2)`/`waitMicros(10)` + `pulseIn(P12, High, maxCm*50)`, cm =
`floor(d*34/2/1000)`. A faithful port needs G1 + `pulseIn` + a native `waitMicros` - and
**`waitMicros` is a general `control`-timing op, not a `gpio` method** (placement to settle at G2
prep).

**Relation to the IR-receive primitive (its design is locked - see the parent plan
`cpp-vm-on-hardware-plan-2026-06-05.md`, "Native IR receive").** Both are native C++ Device-API
primitives that wrap the same CODAL pulse facility (`getPulseUs`) because the VM cannot time
microseconds in bytecode. But the **timing models differ**, so IR's machinery does not transfer
wholesale: IR is a long (~70 ms), asynchronous, continuous NEC frame, decoded **in the background
(interrupt-driven, non-blocking)** into a polled "last code" register; the ultrasonic is a short,
**on-demand, request-response** measurement, naturally a **blocking** `getPulseUs` bounded by a
timeout. The shared design question to settle together: does the ultrasonic read **block** the VM
(stall bounded by a capped timeout - IR's "don't stall the single-entry loop" concern is why the cap
matters), or also use a background/polled-register approach.
