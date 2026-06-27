# Spec: buttons

The micro:bit button feature across both surfaces it is exposed through: the **Tiles** surface (the
four button sensor tiles `[A]`/`[B]`/`[A+B]`/`[logo]`; Identity ... Device and trace below) and the
**Device API** (the raw `ctx.microbit.buttonA/buttonB/logo` reads; see Device API). The cross-cutting
`ctx.microbit.*` conventions and the Device-API registry index live in `docs/specs/microbit-context.md`.

Status: implemented (both VMs) - semantics resolved 2026-06-17; wodal oracle + C++ mirror
landed and gated 2026-06-17 (ids, thresholds, state machine, and trace line format pinned
below). This is the first sensor tile, so it sets precedent for the poll-on-sensors stance.

## Identity

One underlying mechanism is exposed as **four** sensor tiles - one per physical input -
because button sensors are **non-inline** (see Behavior), so a combination like A-and-B
cannot be composed from the single-button tiles and needs its own tile.

| Tile     | Input            | CODAL source                  | Tile key                  | Action id | Function id |
| -------- | ---------------- | ----------------------------- | ------------------------- | --------- | ----------- |
| `[A]`    | button A         | `uBit.buttonA` (Button)       | `microbit-v2.button-a`    | 1024 (reused) | 1033 (reused) |
| `[B]`    | button B         | `uBit.buttonB` (Button)       | `microbit-v2.button-b`    | 1027      | 1036        |
| `[A+B]`  | A and B together | `uBit.buttonAB` (MultiButton) | `microbit-v2.button-ab`   | 1028      | 1037        |
| `[logo]` | logo touch       | `uBit.logo` (TouchButton)     | `microbit-v2.button-logo` | 1029      | 1038        |

The six modifier tiles carry these ids: `microbit-v2.pressed`, `microbit-v2.released`,
`microbit-v2.click`, `microbit-v2.double-click`, `microbit-v2.long-click`, `microbit-v2.held`
(the first two are reused from the old button-A sensor). Flattened arg-slot order is exactly
that list: slot 0 pressed, 1 released, 2 click, 3 double-click, 4 long-click, 5 held; argc is
always 6 and a present modifier slot carries the number `1`.

| Field         | Value |
| ------------- | ----- |
| Kind          | sensor |
| Stance        | poll sensor - events derived from polled state, no bus listener (see Behavior) |
| Composability | non-inline (rule trigger only) - why `[A+B]` is its own tile |
| Module        | microbit-v2 (`mindcraft.microbit-v2`) |
| Labels        | `[A]` `[B]` `[A+B]` `[logo]` |

Function/ABI ids are append-only (assigned at implementation, never
renumbered/reused). The four tiles share one derivation mechanism, parameterized by which
input and which modifier.

## Authoring

A button sensor is a rule **trigger** (the rule's "when"). Each tile takes one optional
**modifier** choosing which button event fires the rule:

`[pressed]` `[released]` `[click]` `[double click]` `[long click]` `[held]`

The modifiers are **optional** and **mutually exclusive** (a tile carries at most one).
**When omitted, the modifier defaults to `[pressed]`.**

```
when: A                  // defaults to: A pressed
when: A pressed
when: B long click
when: A+B held
when: logo double click
```

## Modifier grammar

Each button tile takes one optional modifier, expressed with the core call-spec grammar
(`packages/core/src/runtime/call-spec.ts` - the same machinery the sim's `move`/`see` tiles
use), not a single enum parameter:

```
callDef = mkCallDef(
  bag(
    optional(choice(
      mod(Pressed), mod(Released), mod(Click),
      mod(DoubleClick), mod(LongClick), mod(Held)
    ))
  )
)
```

- Each modifier is a **modifier tile** `mod(id)` - a keyword flag (presence, no inline
  value), each with its own tile id + label + icon in the exported `modifiers[]` list.
- `choice(...)` makes the six **mutually exclusive** (exactly one of); the wrapping
  `optional(...)` makes the whole choice **zero-or-one**. (Together: at most one modifier.)
- **The `pressed` default is resolved in the body, not the grammar:** when no modifier slot
  is present, exec treats it as `pressed` (mirroring how `move` picks its default direction
  in code rather than in the grammar). The body therefore presence-tests the other five
  slots and falls back to `pressed`; the `pressed` slot itself is never tested.
- **Not `repeated`** - button modifiers do not stack (unlike sim's `quickly`/`nearby`,
  where the repeat count scales the effect).
- The body reads each modifier by a slot id resolved once at module load
  (`getSlotId(callDef, Click)`, ...) and tests presence with `hasArg(args, slot)`.

The four tiles (`[A]`/`[B]`/`[A+B]`/`[logo]`) are **four separate sensor actions**, each
registering this same modifier grammar - a sensor is non-composable, so they cannot be one
parameterized tile (hence the standalone `[A+B]`).

## Behavior

- **Poll-derived, not bus-driven** (per the adopted stance). The firmware polls the raw
  pressed state (`isPressed`) each tick via a sync host-function; a **target-layer per-input
  state machine** derives the events from that polled stream plus the VM's logical tick
  time. CODAL's button/message-bus event engine is **not** used - this sidesteps the
  bus-listener hazard (a hardware listener that may not fire) and keeps the sensor deterministic and
  trace-parity-checkable. The CODAL event vocabulary is the naming reference, not the
  mechanism.
- **The sensor is evaluated each tick and returns a boolean** (like `see`): true on the
  tick(s) its modifier's condition holds. **Edge** modifiers (`pressed`/`released`/`click`/
  `double click`/`long click`) return true on exactly the one tick the event occurs;
  **`held` is a level** condition - true on every tick the button is pressed.
- **Per-call-site independence.** Each tile instance keeps its own derivation state
  (`getCallSiteState`/`setCallSiteState`); one call site's modifier or state never affects
  another call site of the same sensor.
- **Modifiers are independent - no suppression anywhere.** No cross-modifier suppression
  (a double-press also fires `pressed`/`released`/`click`; a `double click` does not
  suppress the underlying `click`s) and **no cross-call-site suppression** - in particular
  `[A+B]` does not suppress `[A]`/`[B]`, so pressing both fires all three rules
  independently. (Diverges from CODAL's MultiButton, which suppresses the singles.)
- **Non-inline / non-composable.** A button sensor is a rule's top-level trigger, not an
  inline boolean composable with `and`/`or`/`not` - this is why `[A+B]` exists. Whether a
  rule may pair a button trigger with non-button conditions is governed by the brain
  tile-language syntax, **out of scope for this tile spec.**

### Per-modifier semantics

Let a "press" be a polled transition released->pressed and a "release" pressed->released.

| Modifier       | Trigger | Fires when |
| -------------- | ------- | ---------- |
| `pressed`      | edge    | a press edge is observed |
| `released`     | edge    | a release edge is observed |
| `click`        | edge    | a release whose preceding press was shorter than the long-click threshold |
| `long click`   | edge    | a release whose preceding press was at least the long-click threshold |
| `double click` | edge    | a second press begins within the double-click window after a click |
| `held`         | level   | the button is currently pressed (every tick, no initial delay) |

## Timing (thresholds)

The derivation is ours (not CODAL's gesture engine), so the thresholds are defined in VM
logical tick time and pinned in the target layer so both VMs agree. **Start with CODAL-like
values**, tuned later:

| Threshold            | Pinned value | Notes |
| -------------------- | ------------ | ----- |
| long-click threshold | 1000 ms      | press >= this on release -> `long click`, else `click` (`LONG_CLICK_THRESHOLD_MS`) |
| double-click window  | 500 ms       | second press within this of a click -> `double click` (`DOUBLE_CLICK_WINDOW_MS`) |

Both constants are pinned in the target layer in two mirrored copies:
`packages/wodal/src/targets/microbit-v2/mindcraft/actions/button-sensor.ts` (the oracle) and
`cpp/targets/microbit-v2/abi/host-actions/sensors/button-sensor.h` (the C++ mirror).

### Pinned state machine (per call site)

State is four fields - `prevPressed`, `pressStartMs`, `lastClickMs`, `hasPendingClick` -
keyed to VM logical tick time in ms (in C++ a four-element managed list; in wodal a plain
object). On the first evaluation after a page enter the state is seeded at the current polled
level (`prevPressed = pressed`, no event). On each later tick, with `now = ctx.time`:

- `pressEdge` (prev released, now pressed): fire `pressed`; if `hasPendingClick` and
  `now - lastClickMs <= 500`, also fire `double click` and clear the pending click; set
  `pressStartMs = now`.
- `releaseEdge` (prev pressed, now released): fire `released`; if `now - pressStartMs >= 1000`
  fire `long click`, else fire `click` and set `lastClickMs = now`, `hasPendingClick = true`.
- `held` is the level `pressed` (no edge, no delay).

Each call site runs the full machine and returns its selected modifier's event (default
`pressed`). There is no cross-modifier or cross-call-site suppression.

There is **no hold threshold**: `held` is a level condition with no initial delay (fires
from the first pressed tick). Tick granularity caps resolution (the think loop runs at
~16 ms), so thresholds round to whole ticks; the pinned values must be tick-expressible.

## Device and trace

- Device port: the existing `ButtonInputPort.isPressed(index)` poll, extended so index 2 is
  the logo (0 = A, 1 = B). The derivation state machine lives in the microbit-v2 target layer
  (wodal module oracle + C++ mirror), fed the polled state + tick time. `[A+B]` reads indices
  0 and 1 and ANDs them; the C++ button bodies reach the port through a
  `MicroBitV2ButtonSensorEnv` that also carries the heap + GC roots backing the per-callsite
  state list.
- `[logo]` is capacitive touch (TouchButton) but is treated like any other button (same six
  modifiers); its touch sensitivity uses a **hard-coded default capacitance/threshold** (no
  exposed calibration).
- Injectable input (for parity tests): button down/up edges scheduled at ticks. The harness
  is a per-think schedule of optional A/B/logo levels applied before each time advance - in
  wodal a `{ advanceMs, a?, b?, logo? }` step list driving `setButtonPressed`/`setLogoTouched`
  (`button-sensor-trace.spec.ts`), mirrored in C++ as a `{ advanceMs, a, b, logo }` step list
  (`-1` = unchanged) driving the host stub's button levels (`trace-parity.test.cpp`).
- Observable trace (format version 1, unchanged): a sensor fire renders as the existing
  synchronous host-action line `action <actionId> site <callSiteId> args 6 <6 slots> result
  bool 1`, where the present modifier slot renders `number 3f800000` (the f32 bits of `1`) and
  the rest `nil`; a non-firing tick renders the same line ending `result bool 0`. No new trace
  line kind was added.

## Device API (`ctx.microbit.buttonA/buttonB/logo`) - wired both VMs 2026-06-17

The raw pressed level (and the logo's touch config), surfaced to TS user code. **Not 1:1 with the
tiles:** `isPressed()` is the raw level; the click/hold/double-click derivation lives only in the
sensor tiles (above), not here. The `isPressed()` reads **share the same per-input poll** the sensor
tiles consume (one poll, both surfaces): in C++ both surfaces read `ButtonInputPort::isPressed(index)`;
in wodal both read the same `Button`/`TouchButton` device objects.

| `ctx.microbit.*` | Methods | Port |
| ---------------- | ------- | ---- |
| `buttonA` | `isPressed()` | `ButtonInputPort` (index 0) |
| `buttonB` | `isPressed()` | `ButtonInputPort` (index 1) |
| `logo` | `isPressed()`, `getThreshold()`/`setThreshold()`, `getValue()`/`setValue()` | `ButtonInputPort` (index 2) for `isPressed`; touch config separate |

- The `[logo]` tile hard-codes capacitance; the Device API exposes the raw touch config (a deliberate
  not-1:1).
- `Button.isPressed` (host-fn 1027) and `TouchButton.isPressed` (1028) share one C++ body keyed by
  the receiver discriminator. (The C++ `microBitFieldGetter` resolves `buttonA`/`buttonB`/`logo`.)
- **No `buttonAB` on this surface:** the `[A+B]` brain *tile* (the Tiles) exists because button
  sensors are non-composable, but TS user code reads `buttonA` and `buttonB` independently and `&&`s
  them, so the composite is not exposed here.

## Simulator (apps/microbit-sim)

The on-screen board's **A / B buttons** and a **logo-touch** affordance are the input UI -
clicking/holding them injects the pressed state (driving the same wodal
`setButtonPressed`/`setLogoTouched` path the parity harness scripts) that both the sensor
tiles and `ctx.microbit.*.isPressed()` read. (A/B are present in the sim; confirm a logo-touch
affordance exists or add one.)

## Replacement (no back-compat)

These four tiles **overwrite the existing button-A sensor** outright - no back-compat, no
graceful deprecation (user directive 2026-06-17):

- **Remove** the current single button-A sensor: wodal `targets/microbit-v2/mindcraft/
  actions/button-a.ts` and cpp `targets/microbit-v2/abi/host-actions/sensors/button-a.h`,
  plus its tile-id / ABI entries. It is replaced by the four-tile + six-modifier design
  above, not kept alongside.
- **ABI ids:** `[A]` **reuses** the existing button-A sensor's id - a blessed, one-time
  exception to the append-only-ids rule (user, 2026-06-17), safe only because no persisted
  program references it in this single-build world. `[B]`, `[A+B]`, `[logo]` get **new
  appended** ids. The exception is scoped to `[A]` here and does **not** loosen the
  append-only rule generally; id reuse remains forbidden by default.
- **Update/regenerate affected fixtures and tests**, in particular the `button-display`
  brain and its `button-display.press-cycles.trace` golden (the existing button-A-sensor
  parity fixture) - rewrite the brain to the new design and regenerate, and update the C++
  parity cases that consume it.
- **Unaffected:** the user-tile `isPressed` host-function (`host-functions/button-is-pressed.h`,
  the `ctx.microbit.buttonA.isPressed()` surface) is a *different* surface - it is the
  underlying poll the new sensor's derivation reads, so it stays; the `user-tile-button-display`
  golden is untouched unless the implementation says otherwise.

## CODAL capability coverage

Per the full-surface-design principle, the whole CODAL button/touch capability set is accounted for;
each item is shipped / composable / designed-out / deferred (never silently omitted).

- **Shipped:** the four sensor tiles (`[A]`/`[B]`/`[A+B]`/`[logo]`) + 6 derived-event
  modifiers (pressed/released/click/double-click/long-click/held); Device-API `buttonA`/`buttonB`/
  `logo` `isPressed()` + the logo touch config (`getThreshold`/`setThreshold`/`getValue`/`setValue`).
- **DESIGNED OUT - deliberate architectural choice: CODAL's message-bus button EVENT engine**
  (DOWN/UP/CLICK/LONG_CLICK/HOLD/DOUBLE_CLICK events). We **poll the raw level and derive the events**
  in the target layer instead (the poll-derived, not bus-driven stance - see Behavior - to avoid the
  unreliable-hardware-listener hazard and stay trace-parity-checkable). The 6 modifiers replicate
  CODAL's event vocabulary via our own derivation; CODAL's events are the naming reference, not the
  mechanism.
- **Composable / designed out:** `wasPressed()` (latching "pressed since last read" - the `pressed`
  edge modifier, or composable from the poll); `getPresses()` (press count - count edges); `A+B` on
  the Device API (`buttonA && buttonB` - already noted in Device API).
- **DEFERRED / not exposed: TouchButton calibration + touch mode.** CODAL's `touchCalibrate()` and the
  capacitive-vs-resistive touch mode are not exposed - the `[logo]` hard-codes its
  capacitance/threshold (no exposed calibration). Add if a consumer needs to tune/recalibrate touch.
  (Pin touch via `TouchButton` is a separate future under `docs/specs/gpio.md`.)

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors the derivation
  state machine + thresholds; goldens enforce the match.
- Golden fixtures (each `<name>.mcprogram.bin` + `<name>.ticks.trace`, byte-matched by
  `cpp/test/trace-parity.test.cpp`): `button-display` (regenerated - `[A]` default pressed on a
  press-cycles schedule), plus one brain per modifier on input A - `button-pressed`,
  `button-released`, `button-long-click`, `button-double-click`, `button-held` - and one per
  alternate input - `button-b`, `button-ab` (pressed), `button-logo`. The wodal generator is
  `button-sensor-trace.spec.ts`.
- This is a **read** surfaced as a poll; no async-handle budget is involved.
