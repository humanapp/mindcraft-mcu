# Spec: background sensor driver

A device-runtime mechanism, not a `ctx.microbit.*` peripheral. It runs the measurements for sensors
that **cannot be measured synchronously inside the VM** - sensors needing microsecond pulse timing or
a continuous decode - on a **device-owned background CODAL fiber**, and exposes each as a **cached
value the VM reads synchronously**, **keyed by the sensor's pins** (the argument is the identity,
exactly like `gpio`/`i2c`). Consumers: the **sonar** ultrasonic distance sensor (`docs/specs/sonar.md`)
and the **NEC IR-receive** decoder (its own spec, TBD). New sensors of this shape register here.

## Why this exists

Some measurements can't be a plain sync host-function:

- They need **microsecond timing** the round-based VM cannot do in bytecode (an SR04 echo width; the
  NEC bit timing).
- Done **synchronously on the VM fiber** (a host-function that waits for the echo / decode), they would
  stall the **entire VM** - host-functions run inside the single-entry loop, so `think()` cannot proceed
  until the call returns, no matter how the wait is implemented. For an active ping that is also
  per-reader: N readers would stall N times and **corrupt each other** (overlapping measurement windows).

So the measurement moves off the VM onto a **background fiber**, whose wait **yields to the scheduler**
(CODAL's pulse measurement `getPulseUs` fiber-blocks - it yields, it does not busy-wait), so the VM
fiber keeps running; the VM reads a cached result instead of performing the measurement itself.

## The mechanism

- **One device-owned background CODAL fiber** (the *sensor driver*) services all registered sensors
  (one shared fiber, never a fiber per measurement - respect the `.bss` VM-region constraint). Each
  cycle it refreshes each sensor's cached value: it emits the trigger, then performs CODAL's
  **fiber-blocking** pulse measurement (`getPulseUs`), which **yields to the scheduler** during the
  echo wait (it does not busy-wait). So the VM fiber keeps running while a measurement is in flight;
  only a negligible active-trigger blip (~10 us) is synchronous.
- **The VM reads the cached value with a plain SYNC host-function** - the same shape as a passive
  onboard sensor read (`getGesture`, `isPressed`). There is **no async handle and no `AWAIT`**: the
  async lives entirely inside the driver fiber; the VM-facing surface is a synchronous poll of a
  cached value.
- **Single-entry is trivially preserved.** The driver fiber **never re-enters the VM** (`think()` /
  `runFiber()` / handle resolution) - it only writes shared cache state. CODAL fibers are
  **cooperatively scheduled** (one runs at a time, no preemption), so the driver writes the cache
  between its own yields and the VM reads it during its own `think()`; there is no concurrent access,
  no lock, and no callback into the VM.

## Addressing: keyed by pins (accessed, not constructed)

A sensor is **not** a user-instantiated, held object - user code (a per-chassis driver library) has
no single program-init scope to construct one in and share it (every callsite runs its own module
init, so an allocate-and-hold factory would build a second sensor on the same pins per callsite).
Instead the VM-facing surface is a **flat host-function keyed by the sensor's pins**, identical in
shape to `gpio.digitalRead(pin)` / `i2c.writeBuffer(addr, ...)`:

- `ctx.microbit.sonar.distance(trig, echo)` names a sonar by its pins; `ctx.microbit.ir.lastCode(pin)`
  (its spec TBD) names an IR receiver by its pin. The **pins are the identity** - one physical wiring,
  one sensor.
- **No construction, no holding.** Any callsite, from any module init, that names the same pins
  reaches the **same** sensor. Pins vary by chassis, so the per-chassis library supplies them (pin
  constants are stable across re-init; only stateful *instances* would not have been).
- **Registration on first reference.** The first call naming a given pin-set registers that sensor
  with the driver (the driver begins triggering/listening); the registry is a small, fixed,
  append-only set keyed by pins, cleared only on program reset. There is no separate start/subscribe
  call and no instance lifecycle.

This keeps sonar/IR consistent with the existing edge-connector primitives and needs **no new object
model** (no user-instantiated native-struct type, no host-fn-returns-typed-instance compiler path).
If a sensor later grows a real cluster of operations, an idempotent keyed getter returning a shared
port object (`microbit.sonar(trig, echo).readDistance()`, find-or-register by pins, **not** allocate)
is the upgrade path - not warranted while the per-sensor surface is one read.

## Sensor kinds

A registered sensor is one of:

- **Active** (e.g. ultrasonic): the driver must **trigger** a measurement each cycle (emit the trigger
  pulse, then measure the echo with the fiber-blocking pulse measurement), then cache the result.
  Triggered per cycle while the sensor stays registered (from first reference until program reset).
- **Passive** (e.g. NEC IR-receive): the signal arrives on its own; the driver's event handler
  **decodes continuously** and caches the last value (the "last code"). Always listening from
  registration; no trigger.

Both expose the identical VM-facing surface: a pin-keyed sync read of the cached value.

## The VM-facing contract

- **A read returns the most-recent COMPLETED measurement**, i.e. the value from the **previous driver
  cycle** - a deterministic, fixed **one-cycle lag**. (For a robot or a remote, one `think()`
  (~16 ms) of latency is immaterial.) The driver cycle runs **once per tick, immediately after
  `think()`**, over a single-buffer cache - so a read at think N returns the cycle-(N-1) measurement,
  and the registering (first) read returns the initial value. Both VMs run the cycle at the same point.
- **Shared.** All readers of a given sensor in a `think()` get the **same** cached value - one
  measurement per sensor per cycle, regardless of how many rules read it (no overlapping-ping
  corruption; bounded cost).
- **Bounded within a cycle.** An active measurement's timeout is **capped so it always completes
  within one driver cycle** (so the one-cycle lag holds). For the ultrasonic that caps the usable
  range (a far-echo timeout must be shorter than the cycle); a timeout/no-signal yields the sensor's
  defined miss value (e.g. max distance / a "no code" sentinel).
- **Initial value.** Before any measurement has completed, a read returns the sensor's defined initial
  value (e.g. max distance / "no code").

## Sim parity (both VMs byte-match)

wodal has no CODAL fibers or pin events. The simulated driver is a **logical-time** component: each
`think()` cycle it produces the sensor's value from **injected input** (the echo duration for the
ultrasonic, the received code for IR - via the same injectable-input harness pattern the onboard
sensors use) and updates the cache with the **same one-cycle lag**. The device measures the real
signal; the sim injects it; in a golden the injected value **is** the device's measured value, so the
cached value at `think N` is byte-identical across both VMs.

The determinism rests on three things, which the contract pins: (1) a sensor's **identity is its
pin-key** - a pure function of the pins, so both VMs agree which sensor is which with no
creation-order dependence; (2) the **one-cycle lag** (the cache at `think N` is the cycle-N-1
measurement) is identical on both VMs; and (3) the device measurement always completes within the
cycle (the cap), so the device cache is refreshed on the same schedule as the sim's logical-time
update. No variable-wall-clock timing reaches the VM - only the cached value and a fixed lag, both
deterministic.

## Observable trace

A sensor's measurement is observable as a deterministic trace line when its value is refreshed /
read (the exact line is each sensor's, defined in its feature spec + `docs/specs/contracts/observable-trace.md`,
format-version pinned). Because the value and the lag are deterministic, the trace is reproducible and
byte-matched across both VMs under the injected schedule; no wall-clock timing appears in the trace.
