# Spec: sonar (ultrasonic distance)

An edge-connector **Device-API** sensor (no tile) for an SR04-style ultrasonic distance sensor on the
edge connector. A consumer of the **background sensor driver** (`docs/specs/background-sensor-driver.md`):
the measurement needs microsecond echo timing the VM cannot do in bytecode and would stall the VM if
done synchronously, so a background fiber measures it and the VM reads a cached distance.

## Surface

- `ctx.microbit.sonar.distance(trig, echo) -> cm` - the latest cached distance in centimetres for the
  ultrasonic sensor wired to the `trig` / `echo` pins. A `sonar` singleton native-struct sub-field with
  one `distance` method, mirroring the `i2c` / `gpio` shape. Device-API only, no tile.
- **Keyed by pins, accessed not constructed** (see the background-sensor-driver spec): the `trig` /
  `echo` pins are the sensor's identity and are runtime **arguments** (chassis-varying - e.g. ELECFREAKS
  Cutebot wires trig P8 / echo P12, DFRobot Maqueen trig P1 / echo P2). The first reference to a pin pair
  registers the sensor with the driver; every later reference shares its cache.
- **One-cycle lag** (the driver contract): a read returns the previous driver cycle's measurement; the
  registering (first) read returns the initial value.

## Behavior

- **Distance:** `cm = floor(echoUs * 34 / 2 / 1000)` - integer math, identical on both VMs.
- **`SONAR_MAX_DISTANCE_CM = 200`** serves three roles: the initial value (before any measurement
  completes), the timeout / miss value (no echo), and the clamp ceiling.

## ABI ids (append-only)

- `MicroBitField.Sonar = 7`
- type-atom `Sonar = 1031`
- host-function `SonarDistance = 1056`

## Observable trace

`port sonar distance <trig> <echo> <cm>` - the pins + the returned cm, all minimal lowercase hex,
emitted on each read (mirrors the `gpio` read trace). Additive; observable-trace format version
unchanged.

## CODAL capability coverage

- **The measurement** (the platform concern) runs on the background sensor driver - see that spec for
  the background-fiber mechanism, the cached sync-read, and the sim-parity model.
- **Distance conversion + range clamp** are the spec behavior above.
- **Multi-sensor:** several sonars (different pin pairs) register independently and share nothing; the
  readers of one sonar share its single per-cycle measurement.

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors it. Golden `user-tile-sonar`
  (two reads of one pin-keyed sonar per `think()` under an injected echo width - the initial value then
  the measured value, demonstrating shared-per-cycle reads + the one-cycle lag) byte-matches
  wodal<->cpp.
- The ambient `.d.ts` typechecks against `ctx.microbit.sonar.distance`.
