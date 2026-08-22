# Spec template (per-feature)

The canonical skeleton for a micro:bit device-**feature** spec. Copy this file to
`docs/specs/<feature>.md`, keep only the **surfaces the feature is actually exposed through**, fill
each, then delete the "(Guidance:)" notes and the **Open questions** section once the spec is
normative.

A feature spec covers the whole feature **across every surface it appears on** - **Tiles** (the brain
tile language), the **Device API** (`ctx.microbit.<feature>`), and the **Simulator**
(`apps/microbit-sim` UI + any custom editors) - plus a **CODAL capability-coverage** audit. Not every
feature uses every surface: an edge-connector primitive (e.g. `i2c`, `gpio`) is **Device-API-only**
(omit Tiles); an onboard sensor is usually Tiles + Device API. The cross-cutting `ctx.microbit.*`
conventions and the surface registry index live in `docs/specs/microbit-context.md`.

Examples to follow: `accelerometer.md` / `button.md` (Tiles + Device API + Simulator), `display.md`
(the draw family + Device API + editors), `i2c.md` / `gpio.md` (Device API only, no tile).

The governing stance defaults: **poll on sensors, await on actuators with a temporal quality.** Each
surface states which bucket it occupies and justifies any deviation (e.g. a sensor taking the event
exception, against the bus-listener hazard - a hardware listener that may not fire).

**Specs are eternal.** Do NOT put dates, phase/work-item markers (e.g. `G1`, `I2`, `D3b`, `6f4`), or
build-status ("wired both VMs", "host-gated", "as-built", "accepted") in a spec - those belong in the
build plan (kept locally, not committed). Keep only the design, the behavior, and the permanent
(append-only) ABI ids. Capabilities not yet built are described as design intent, not dated status.

---

## Overview

One paragraph: what the feature is, which surfaces it is exposed through, and the ABI ids
(append-only - once assigned, never renumbered or reused; write `TBD` while drafting).

## Tiles (omit if the feature has no tile)

The brain tile-language surface: what a brain author writes, how its arguments parse, what it does at
runtime, which **stance bucket** it occupies, and how its behavior is verified byte-for-byte across
the TypeScript and C++ VMs.

### Identity

(Guidance: one mechanism may back several tiles - render it as a **family table**; a single tile is a
one-row table.)

Family table (omit if a single tile):

| Tile | Input / effect | CODAL source | Tile key | Fn/Action id |
| ---- | -------------- | ------------ | -------- | ------------ |

Core fields:

| Field         | Value |
| ------------- | ----- |
| Kind          | sensor \| actuator |
| Stance        | poll sensor (sync read) \| sync actuator (instant) \| async/awaited actuator (temporal) -- note any deliberate exception + why |
| Composability | inline (composable into conditions/expressions) \| non-inline (rule trigger only) |
| Module        | e.g. microbit-v2 (`wendoo.microbit-v2`) |
| Label(s)      | the on-tile text the author sees |

### Authoring

What the brain author writes and where it sits (a rule's `when` trigger, its `do` section, or inline
in a condition). Include a short fenced example.

### Arguments / modifiers

Tiles declare their argument grammar with the core call-spec combinators
(`packages/core/src/runtime/call-spec.ts`); `mkCallDef` flattens the grammar tree into a fixed,
position-indexed **slot array** the runtime body reads by id. Author-facing grammar, runtime-facing
slots. Principles (see the sim `move`/`see` tiles for worked examples):

- **Combinators:** `bag(...)` unordered (the usual top level), `seq(...)` ordered, `choice(...)`
  exactly-one (mutual exclusion), `optional(x)` zero-or-one, `repeated(x,{min,max})` repetition,
  `conditional(name, then, else?)` includes args only when a *named* sub-spec matched
  (context-sensitive availability).
- **Two arg kinds:** `mod(id)` = a modifier (keyword flag, no inline value); `param(id, {anonymous,
  required, name})` = a typed value (anonymous = no label, typed inline).
- **Repeated MODIFIERS carry magnitude:** a repeated `mod`'s slot holds its **count**, and the body
  scales by it (e.g. "quickly quickly" = faster). **Repeated PARAMS gather a `List<T>`** (the body
  reads the list); modifiers count, params list - distinct.
- **Defaults live in the body, not the grammar:** the grammar marks things optional; when a slot is
  absent the exec function picks the default behavior.
- **The body never hardcodes indices:** it resolves `getSlotId(callDef, Tile)` once at module load,
  then reads with `hasArg(args, slot)` / `extractNumberValue(args.get(slot))`.
- Tile metadata is exported separately from the grammar as `modifiers[]` / `parameters[]` (id, label,
  iconUrl, dataType, anonymous/hidden).

Summarize the resulting slots:

| Slot | Name | mod/param | Type | Required | Anonymous | Default |
| ---- | ---- | --------- | ---- | -------- | --------- | ------- |

### Behavior

State the **stance bucket** and why, then the runtime semantics:

- **Sensor:** poll-derived (read the latest state each tick) or the event exception (justify against
  the bus-listener hazard). Edge vs level. Firing model (once per occurrence vs evaluated
  continuously). If events are derived from polled state, describe the derivation.
- **Actuator:** sync (instantaneous, returns immediately) or async (allocates a pending handle, the
  rule `AWAIT`s and parks until completion, does not re-fire while parked). State concurrency behavior
  (serialize / reject / overlap / silent-drop / preempt).
- Composability: if non-inline, say so and why (e.g. why a combined tile exists instead of composing
  simpler ones).

### Timing / derivation

(Guidance: anything time- or state-dependent is pinned in the **microbit-v2 target layer** - the
wodal module is the oracle, the C++ port mirrors it, goldens enforce the match - **not** core
`vm-contract.md`. All timing is against the VM's logical tick time, never wall-clock or
animation-frame time. Use one of:)

- **Actuator completion formula** (async): the closed form for the completion tick.
- **Sensor derivation** (poll): the state machine + thresholds; thresholds are tick-expressible (the
  think loop is ~16 ms, which bounds resolution).
- **n/a** for an instantaneous sync tile.

### Device and trace

- **Device port:** the port method(s) the tile calls (read for a sensor poll, effect for an
  actuator).
- **Injectable input** (sensors): the deterministic value/event a parity test scripts in (the
  per-capability "injectable input" from the CODAL inventory) - required for a sensor read to be
  trace-parity-checkable.
- **Observable trace** (target contract, state the format version): the line(s) emitted when the tile
  crosses the port / fires.

## Device API (`ctx.microbit.<feature>`) (omit if not exposed to TS user code)

The `ctx.microbit.*` host-function surface (TS user code) - the lower-level device API, tracking the
device / `*Port` shape, not the tile semantics. Sync for instantaneous reads/writes; awaited (op 41
`HOST_CALL_ASYNC`) for temporal effects (shares the lease with the tile form).

| `ctx.microbit.<feature>.*` | Returns | Notes |
| -------------------------- | ------- | ----- |

- **ABI ids (append-only):** `MicroBitField.<F> = N` (appended LAST per the native-struct
  field-order invariant in `microbit-context.md`), type-atom id, host-function ids.
- **Not 1:1 with the tile:** note where the raw Device API differs from the tile (the tile may add
  derivation / level / modifier semantics on top of the raw read/write).
- Where a capability is composable in TS rather than a primitive, say so (it belongs in Capability
  coverage, not as a host function).

## Simulator (apps/microbit-sim)

The peripheral's UI affordance in `apps/microbit-sim` representing its inputs and/or outputs (the
interactive surface). Describe it:

- **Sensor input:** an interactive control that injects the value/event - e.g. a gesture dropdown +
  trigger, a slider, the on-screen buttons. It drives the **same wodal injectable-input path the
  parity harness scripts** (UI = interactive front-end; harness = scripted).
- **Actuator output:** how the effect is rendered (e.g. the LED matrix).
- **Custom editor** (if any): an asset editor for a value the feature consumes (e.g. an image
  editor), in the brain editor and/or VS Code.
- `apps/microbit-sim` owns the UI; `wodal` owns the underlying injectable mechanism it drives.

## CODAL capability coverage

Per the full-surface-design principle, account for the **whole CODAL capability set** of this feature
- each capability marked, none silently omitted:

- **Shipped:** built (name the surface).
- **Composable / designed out:** expressible from the shipped primitives in TS user code, or
  deliberately not a primitive - say which and why.
- **Designed, not built:** a capability designed here but not currently a primitive - say why there
  is no consumer (describe it as design intent; do NOT reference a build phase or date - those live
  in the plan).

(Design-complete is not build-everything: design the whole surface, build the minimum, mark every
deferral. Cutebot - or whatever the current consumer is - drives build *priority*, not design *scope*.)

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors it.
- Golden fixtures (name them): `<fixture>.mcprogram.bin` + `<fixture>.ticks.trace`, byte-compared by
  the C++ parity test.
- For sensors, the scripted injectable-input schedule that drives the golden.
- For async actuators, the `maxHandles` budget (a runtime guard sized against the device budget,
  never a pool size).
- The ambient `.d.ts` typechecks against the declared Device API.

## Open questions

(Draft-only. Each unresolved decision that blocks normative status; delete the section once empty.)
