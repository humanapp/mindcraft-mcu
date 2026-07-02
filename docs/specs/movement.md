# Spec: movement (differential-drive arbitrator)

**Movement** is the arbitrator that turns brain rules into chassis motion. Brain actuators emit on
every frame their rule fires, so the same movement commands arrive over and over, and several rules
may command movement at once. Movement collects every movement command emitted during a think as an
**influence**, blends them into one final wheel pair, and drives the chassis - every think,
unconditionally. When no rule commands movement, the robot stops. The teaching one-liner: **the robot
does what the brain tells it to do** - right now, this think.

Movement is a **user-code System** (`docs/specs/system.md`): a shared singleton with per-think
`think`, built entirely on the System substrate - no VM, runtime, or codec change. It is
chassis-generic (any two-wheel differential drive); each robot binds its own instance to its motor
protocol and names its own tiles (e.g. `cutebot drive`). The chassis binding below is the Cutebot.

## Model: influences over two wheels

Every movement command is a **wheel-pair influence** `(left, right)` in percent of full speed
(`+-100`). The three tiles are the three visibly distinct wheel patterns:

| Tile               | Emission (left, right) | Wheels                          |
| ------------------ | ---------------------- | ------------------------------- |
| `drive s`          | `(+s, +s)`             | both forward                    |
| `turn right s`     | `(+s, 0)`              | one wheel drives, other holds   |
| `pivot right s`    | `(+s, -s)`             | counter-rotate (spin in place)  |

`left` variants mirror (`turn left s` = `(0, +s)`; `pivot left s` = `(-s, +s)`); `drive backward s` =
`(-s, -s)`. The vocabulary is complete and consistent: `turn = 1/2 drive + 1/2 pivot` (an arc is
moving forward while rotating).

- **Turn uses the outer-wheel-push convention**: `turn right` drives the LEFT wheel. A turn with no
  concurrent drive therefore creeps forward in an arc around the held wheel (useful line-reacquire
  behavior). The held wheel stays exactly at rest.
- **Pivot rate is the magnitude**: `pivot slowly left` emits `(-30, +30)` (the `slowly` ladder
  rate) - a slow spin in place. Blended with another rule's `drive 40` it becomes `(10, 70)` - a
  gentle forward-left arc, the physical superposition of the two intents.

## Per-think semantics: blend, emit, decay on silence

Commands are **per-think contributions, not latched state**. Each think starts with empty
accumulators; the influences emitted by this think's firing rules are summed; the result is written
to the chassis; the accumulators clear. Consequences:

- A rule keeps the robot moving by firing (rules re-emit every frame they are true - the normal
  actuator behavior). A rule that stops firing stops contributing.
- **Silence = stop, after a short hold window.** No movement emissions this think -> the **last
  blended target is reused** for up to K consecutive silent thinks (the hold window; K = 3 nominal,
  a module constant, ~60-150ms), then the target drops to `(0, 0)`. The window exists for
  **remotely-commanded brains**: a radio-driven brain's drive rules fire at packet rate, which beats
  against the brain's think rate (clock skew between two devices, plus RF loss), producing periodic
  empty thinks even under a held button - without the hold those gaps stutter the motors (and
  low-pass smoothing makes it worse: averaging the gaps in parks the output below the motor stall
  floor). This is the RC-receiver failsafe-hold pattern: hold the last command briefly, fail safe to
  zero on timeout. Locally-ruled brains re-emit every think, so the window never engages for them.
- **Hold the target, never the influences.** The held value is the final blended target pair; aging
  individual influences instead would double-count a rule that re-emits every think (three live
  copies of one `drive 50` summing to 150).
- **A page switch stops the robot**: the old page's rules stop emitting, so motion stops when the
  hold window expires (at most K thinks, imperceptible). No orphaned motor command survives; nothing
  needs a manual reset. (The System's internal state still persists across the switch, per the
  System contract - it is the emissions that cease.)
- Re-emission is expected and harmless: each firing rule contributes once per think.

## Blending: sum per wheel

Influences **sum per wheel**. Properties of the sum:

- **Identity**: one rule alone produces exactly its commanded value.
- **Order-independent**: rule evaluation order cannot affect the result.
- **Agreement compounds**: two rules pushing the same way push harder (up to saturation).
- **Conflict cancels**: equal opposite pushes produce a tug-of-war zero.

The canonical line follower falls out of three one-line rules:

| Rules firing this think                          | Sum (L, R)  | Robot                         |
| ------------------------------------------------ | ----------- | ----------------------------- |
| `on line -> drive 40`                            | (40, 40)    | straight                      |
| + `left found -> turn left slowly` (30)          | (40, 70)    | arcs left back to the line    |
| + both sensors (a junction): + `turn right slowly` | (70, 70)  | straight through, with a surge|
| line lost (nothing fires)                        | (0, 0)      | stops                         |

The junction case is a named, accepted behavior: simultaneous opposite turns are mirror-symmetric,
so the robot stays straight, and their forward components add (both outer wheels pushing) - it
surges through the crossing rather than holding speed.

## The per-think pipeline

```
0. stop check                           -> if a stop was issued this think: discard all
                                           influences, zero the smoothing state, CLEAR the held
                                           target, write (0, 0), done
1. sum emissions per wheel              -> (tl, tr)          [only when emissions exist this think]
2. drift gain: tl *= (1 + d/200)
               tr *= (1 - d/200)        -> per-wheel gain trim (see Drift)
3. scale-preserving saturation          -> if max(|tl|, |tr|) > 100, scale BOTH by 100/max.
                                           The result is the TARGET; retain it as the held target
                                           (hold age resets to 0).
   on a SILENT think (no emissions)     -> skip 1-3: reuse the held target while hold age < K
                                           (age increments), else target = (0, 0)
4. smoothing per wheel (EMA + snap)     -> out += (t - out) * (1 - s); if |t - out| < 1, out = t
5. stop deadband                        -> |out| < 2 writes 0
6. write both wheels to the chassis     -> every think, unconditionally
```

- **The hold reuses the post-saturation target** (stages 1-3 are skipped on silence), so drift and
  saturation are never re-applied to an already-trimmed value.

- **Saturation scales, never clamps per wheel.** Clamping each wheel independently destroys the
  wheel ratio - the turn geometry - silently straightening an arc. Scaling both wheels by `100/max`
  caps overall speed and preserves the arc. (Order: after drift, so the trim's geometry survives
  the scale.)
- **The stop deadband** (`|out| < 2 -> 0`) avoids PWM jitter near rest; cheap DC motors stall well
  above this anyway.
- **Stop is exclusive: it supersedes the think.** A stop is an override, not an influence. Issuing
  one sets a this-think stop flag; at the output stage the think discards every influence emitted
  this think - whether emitted before or after the stop, so it is order-independent - zeroes the
  smoothing state, **clears the held target** (a stop is never held over), and writes `(0, 0)`: a
  hard brake that bypasses smoothing. If any rule issued a
  stop this think, the robot stops this think, regardless of what else was commanded. The flag
  clears with the think; influences resume normally next think. The canonical use is a safety rule -
  `WHEN [sonar][close] DO [stop]` - which must win over every concurrently firing drive rule.

## Output dynamics: smoothing

A single smoothing factor `s` shapes how the output chases the blended target:

```
out = out + (target - out) * (1 - s)      // per wheel, per think
```

- `s = 0` (the default): `out = target` - **instant**, exactly. The robot does what the brain says
  now; a command step is a PWM step, matching stock MakeCode behavior.
- Larger `s` glides: `s = 0.9` is roughly a 10-think ramp; `s` approaching 1 is a slow drift toward
  the target. The setter clamps to `<= 0.99` (a factor of 1 would freeze the output forever).
- The **near-snap** (`|target - out| < 1 -> out = target`) terminates the exponential tail exactly.
- Smoothing applies to the silence-decay too: at high `s` the robot glides to a stop when rules go
  quiet. `stop()` is the hard-brake escape hatch.

One factor, symmetric. (Asymmetric accelerate/brake rates are a known refinement used by shipped
robot firmware; add a second factor only when hardware tuning demands it.)

## Drift: a per-wheel gain trim

Every physical chassis veers slightly off a commanded straight line, because its two motors deliver
slightly different speed at the same duty - a **multiplicative** (gain) mismatch. The trim is
therefore a gain, not an offset:

```
left  *= (1 + d/200)        // d in +-25; positive d steers right
right *= (1 - d/200)        // d = 10 -> left +5%, right -5%
```

Properties (each is why the trim must be multiplicative, not additive):

- **Calibrate once, straight at every speed.** The corrective differential scales with speed, so the
  corrective curvature is constant. (A fixed additive offset is only correct at the calibration
  speed: it under-corrects above and over-corrects below - at crawl speeds a `+-d/2` offset dominates
  the command and turns "slow straight" into a hard arc.)
- **Zero at zero, by construction.** A stopped robot stays exactly stopped with any drift set - no
  creep, no gating special case.
- **A held wheel stays held.** `turn right` keeps the right wheel at exactly 0 regardless of trim.
- **Pivots run truer**: each motor is corrected for its own gain, which is the actual error.

## Device API (Movement methods; power-user surface, no tiles)

Configuration is exposed as System methods, callable from any user-code tile body. Smoothing and
drift have no tiles (the tile surface stays drive/turn/pivot/stop); `stop()` backs the `[stop]`
tile and is also callable directly.

| Method            | Behavior                                                              |
| ----------------- | --------------------------------------------------------------------- |
| `setSmoothing(s)` | sets the smoothing factor; clamps to `0 <= s <= 0.99`; 0 = instant   |
| `getSmoothing()`  | the current factor                                                    |
| `setDrift(d)`     | sets the gain trim; clamps to `-25 <= d <= +25`; positive steers right|
| `getDrift()`      | the current trim                                                      |
| `stop()`          | exclusive hard brake: supersedes this think's influences, zeroes smoothing state, the think writes (0,0) |

Settings live in System state: they persist across thinks and page switches and reset on reflash. A
power user calibrates in a startup rule (there is no persisted calibration storage; add one only if
real use demands remembered calibration).

## Send policy: every think, unconditionally

The final wheel pair is written to the chassis every think, whether or not it changed:

- **A lost stop self-heals.** With send-on-change, a stop command lost to an i2c glitch or a motor
  controller brownout is never retransmitted - a runaway robot. With re-send, any lost or corrupted
  command is corrected within one think.
- The output stage is **stateless** (no last-sent cache to invalidate across init / page switches /
  controller resets).
- It works for both chassis classes: latched protocols tolerate re-writes; watchdog protocols
  (which failsafe-stop without a periodic refresh) require them.
- The bus cost is negligible (two small writes per think), and identical re-writes are the norm in
  the MakeCode robot ecosystem.

## Chassis binding: Cutebot

- Motor protocol: two 4-byte i2c commands per update - `[wheel, direction, |speed|, 0]` (wheel
  `0x01` = left, `0x02` = right; direction `0x02` = forward, `0x01` = backward) - to the onboard
  STM8 at address `0x10`, via `ctx.microbit.i2c.writeBuffer`. The controller latches each command;
  there is no watchdog.
- Wheel values quantize to integer percent at the wire (an explicit round in user code).
- Cheap DC motors stall below roughly 20-30% duty. The single "slowly" rate word must sit above the
  stall floor (nominally 30); rate words are tuned per chassis on hardware.

## Authoring (tiles)

Per-chassis tiles over the shared Movement instance, all modifiers optional with a working bare
form (the standard tile posture):

```
[drive] [slowly x0-3 | quickly x0-3] [forward|backward?]   bare: forward at the normal rate
[turn]  [slowly x0-3 | quickly x0-3] [left|right?]         bare: right at the normal rate
[pivot] [slowly x0-3 | quickly x0-3] [left|right?]         bare: right at the normal rate
[stop]                                                     no modifiers; exclusive (see Stop)
```

**Rate words compound, up to three, and the sets are mutually exclusive.** Each additional `slowly`
steps the rate further down; each additional `quickly` steps it further up; `slowly` and `quickly`
do not mix on one tile. The call-spec declares the shape:

```
optional(choice(
  repeated(mod(Slowly), { min: 1, max: 3 }),
  repeated(mod(Quickly), { min: 1, max: 3 })
))
```

Exclusivity and the cap are enforced at **authoring time by the picker** (once one set has a fill,
the other is not offered; offers stop at three) - the same enforcement model as the shipped sim
built-ins that use this identical grammar. The tile **body is total** over any count combination it
is handed: if both words are somehow present on one tile, **slowly wins** (the safer precedence for
a physical robot), and counts clamp to 0..3. A rate word never errors at runtime.

The rate ladder (nominal, tuned per chassis):

| slowly x3 | slowly x2 | slowly x1 | bare | quickly x1 | quickly x2 | quickly x3 |
| --------- | --------- | --------- | ---- | ---------- | ---------- | ---------- |
| 10        | 18        | 30        | 50   | 70         | 85         | 100        |

A single `slowly` sits above the DC-motor stall floor (roughly 20-30% duty on cheap chassis);
the compounded `slowly` steps sit deliberately below it - a lone crawl-rate influence may not
overcome stall on real hardware, but it remains meaningful blended with other influences (a fine
trim on top of a drive).

The rate words are a **shared modifier vocabulary** (`modifier.speed.slowly` / `.quickly`,
unscoped shared ids) so a rate modifier is copy/paste-interchangeable across drive, turn, and pivot
tiles.

## Conformance

- Movement is pure user code over the System substrate and the i2c primitive; cross-VM parity is
  inherited, and a real-compiled fixture exercising the pipeline byte-matches both VMs as a guard.
- The pipeline math is pinned by **exact-value tests** (real compiled brains that run): the blend
  sum, the drift gain at two different speeds, wheels exactly 0 at rest with drift set, the held
  wheel exactly 0 under turn + drift, scale-preserving saturation (an over-limit arc keeps its
  ratio), the smoothing curve values and its near-snap, the stop deadband, `stop()` dominance
  within a think, the junction surge, and the rate ladder (each compounded step's exact value; the
  picker never offers a mixed `slowly`+`quickly` tile; a mixed tile body resolves slowly-wins;
  counts clamp to 0..3).
- The **hold window** is pinned from both sides: an alternating command/gap stream (the remote-
  control beat pattern) holds a steady full target - no dip on the gap thinks, including with
  smoothing enabled; silence longer than K thinks drops the target to zero exactly at expiry; a
  stop during the hold zeroes immediately (the held target does not survive a stop); page-switch
  silence stops within K thinks.

## Open questions

- **Rate-ladder values and reverse-steering feel** - the seven ladder magnitudes and how turn
  composes with backward drive are hardware-tuning decisions; the model accepts them as constants
  (the ladder's shape - monotonic, seven steps, ends at crawl and full - is the contract).
- **Asymmetric smoothing** (separate accelerate/brake factors) - a known refinement; deferred until
  hardware tuning demands it.
- **Persisted calibration** (drift surviving reflash) - deferred until a real user demands it; the
  startup-rule pattern covers the power user today.
