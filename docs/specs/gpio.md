# Spec: micro:bit GPIO primitive (`ctx.microbit.gpio`)

The edge-connector GPIO pins (P0-P20), the plumbing a Cutebot-style library consumes for its line
sensors, gripper servos, and ultrasonic. **Device API only - no tile**; a sub-interface of the
`ctx.microbit.*` device API (registry index: `docs/specs/microbit-context.md`). A singleton
native-struct getter `ctx.microbit.gpio` (no discriminator, like `i2c`), bound to CODAL `uBit.io.P<n>`
on device (a pin-number -> `NRF52Pin` lookup) and to an injectable simulated pin model in wodal. A
**pin** is a **number 0-20** (matching pxt / the physical labels); an out-of-range pin is a no-op.
**Pins P3/P4/P6/P7/P9/P10 are shared with the LED display matrix** - using them as GPIO requires the
display disabled (`display.disable()`, a deferred display capability - see `docs/specs/display.md`);
Cutebot's pins do not overlap the matrix, so this is off the Cutebot path.

**The full GPIO capability surface is designed here; capabilities not exposed as primitives are
marked, not omitted** (board features get a complete API design; the current consumer drives build
*priority*, not design *scope*). The micro:bit pin capability set is **digital I/O, pull, servo,
analog/PWM, touch, and pulse measurement**: digital/pull/servo and the analog **read** are
host-function primitives (below); analog write/PWM and touch are designed but not currently exposed
as primitives; the ultrasonic moved to its own `ctx.microbit.sonar` surface (`docs/specs/sonar.md`),
backed by the background sensor driver.

## Digital I/O + pull + servo + analog read (sync host-functions)

| `ctx.microbit.gpio.*` | Returns | CODAL | Notes |
| --------------------- | ------- | ----- | ----- |
| `digitalRead(pin)` | number (0/1) | `getDigitalValue()` | Cutebot line sensors (P13/P14) |
| `digitalWrite(pin, value)` | number (status) | `setDigitalValue(0/1)` | general output |
| `setPull(pin, mode)` | number (status) | `setPull(PullMode)` | `mode`: 0 none / 1 up / 2 down (a small enum); the line sensors set PullNone at init |
| `servoWrite(pin, angle)` | number (status) | `setServoValue(angle)` | Cutebot gripper servos (P1/P2); `angle` 0-180, standard 20 ms period |
| `analogRead(pin)` | number (0-1023) | `getAnalogValue()` | ADC read; a sync poll like `digitalRead` (no filtering - consumers own smoothing); gamepad stick axes (P1/P2) |

- **Sim:** an injectable pin model (a test sets a pin's digital-read value and inspects recorded
  digital/servo writes + pull config) - mirrors the `I2CBus` injectable model. Analog reads are
  served from their own held per-pin map, injected via `Gpio.setAnalogRead(pin, value)` (persists
  until changed; cleared by reset; independent of the digital-level map).
- **Trace:** `port gpio digital-write <pin> <value>`, `port gpio digital-read <pin> <value>`,
  `port gpio set-pull <pin> <mode>`, `port gpio servo-write <pin> <angle>`,
  `port gpio analog-read <pin> <value>` (reads trace the returned value for parity), both VMs +
  `observable-trace.md`.
- **ABI ids + behavior (append-only):** ids `MicroBitField.GPIO = 6`, type-atom `1030`, host-fns
  `1052`-`1055` (digitalRead/digitalWrite/setPull/servoWrite) and `1071` (analogRead). Writes return
  a **status number** (0 = ok); `setPull` mode is a plain number **0 none / 1 up / 2 down** (no
  ambient constant). Pin range **0-20**; an out-of-range pin is a **no-op effect but still emits its
  trace line** with the raw pin (mirrors `display set-pixel`); `digitalRead` / `analogRead` out of
  range return 0. Per-pin ADC capability is CODAL's (no capability table). Servo angle / pull mode
  are not separately validated (CODAL clamps the angle; an unknown pull mode is a device no-op).
  Sync host-fns bound over `&ports` (no env struct - GPIO needs no heap/roots). cpp device impl
  `MicroBitGPIOPort` (`NRF52Pin* pins_[21]` over `uBit.io.P0..P20`, null out of range; analog reads
  CODAL `getAnalogValue()`); wodal injectable `Gpio` (`core/gpio.ts`, records writes/pull/servo,
  serves injected digital + analog reads, cleared by `MicroBit.clear()`).

## Analog write / PWM (designed; not currently exposed as host-functions)

Part of the GPIO capability set, so designed here; not currently exposed as host-functions (no
consumer). Crosses the **port numeric-typing seam** (the analog value narrows f32 -> CODAL's range
identically on both VMs: a port typed to the CODAL signature, the device doing range/early-out, the
narrowed value in the trace).

| `ctx.microbit.gpio.*` | Returns | CODAL | Notes |
| --------------------- | ------- | ----- | ----- |
| `analogWrite(pin, value)` | number (status) | `setAnalogValue(0-1023)` | PWM duty cycle |
| `setAnalogPeriod(pin, periodMicros)` | number (status) | `setAnalogPeriodUs()` | PWM period (us) |
| `servoSetPulse(pin, pulseMicros)` | number (status) | `setServoPulseUs()` | explicit servo pulse width (the Cutebot gripper driver optionally calls it) |

- Trace lines (when exposed): `port gpio analog-write/set-analog-period/servo-set-pulse
  <pin> <value>`.

## Touch pins (designed; via `TouchButton`)

The touch-capable pins (v2: P0/P1/P2) surface through the **existing `TouchButton` type** - a
`touchPin(n): TouchButton` getter returning `Struct(TouchButton, pinN)`, reusing TouchButton's
`isPressed` / `getThreshold` / `setThreshold` / `getValue` / `setValue` over CODAL pin touch
(`isTouched`). The one new mechanism is a getter returning a native struct discriminated by a runtime
pin arg (today's getters are fixed-discriminator). A raw `isTouched(pin): number` is the simpler
alternative if the config object is not wanted.

## Ultrasonic / pulse - moved to its own surface

The SR04 ultrasonic distance sensor is **not** a `gpio` method. It is its own `ctx.microbit.sonar`
Device-API surface (`ctx.microbit.sonar.distance(trig, echo)`), backed by the **background sensor
driver** - the echo measurement needs microsecond timing the VM cannot do in bytecode. See
`docs/specs/sonar.md` (the surface + behavior + ABI ids) and `docs/specs/background-sensor-driver.md`
(the mechanism). The trig/echo pins are runtime arguments (chassis-varying), so it shares the edge
pins with `gpio` but is keyed/measured independently.
