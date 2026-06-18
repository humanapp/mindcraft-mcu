# Tile spec template

The canonical skeleton for a brain tile specification. Copy this file to
`docs/specs/tiles/<tile-name>.md` and fill every section; delete the guidance notes
(the parenthesized "Guidance:" lines) and the **Open questions** section once the spec is
normative. Existing specs that follow this template: `display-scroll.md` (an async
actuator), `button-sensor.md` (a poll-derived sensor family).

A tile spec describes, for one authoring tile - or a **family** of tiles that share one
underlying mechanism - what a brain author writes, how its arguments parse, what it does
at runtime, which **stance bucket** it occupies, and how its behavior is verified
byte-for-byte across the TypeScript and C++ VMs.

The governing defaults (plan, Phase 7): **poll on sensors, await on actuators with a
temporal quality.** Every spec states which bucket its tile is in and, if it deviates
(e.g. a sensor that takes the event exception), justifies it.

---

## Status

One of: `draft` | `proposed` | `implemented (wodal)` | `implemented (both VMs)` |
`accepted` - plus a one-line note (what is pinned, what is pending).

## Identity

(Guidance: one mechanism may back several tiles - render it as a **family table**; a
single tile is a one-row table. Function/Action ids are appended per Locked Decision 2:
once assigned, never renumbered or reused; write `TBD` while drafting.)

Family table (omit if a single tile):

| Tile | Input / effect | CODAL source | Tile key | Fn/Action id |
| ---- | -------------- | ------------ | -------- | ------------ |

Core fields:

| Field         | Value |
| ------------- | ----- |
| Kind          | sensor \| actuator |
| Stance        | poll sensor (sync read) \| sync actuator (instant) \| async/awaited actuator (temporal) -- note any deliberate exception + why |
| Composability | inline (composable into conditions/expressions) \| non-inline (rule trigger only) |
| Module        | e.g. microbit-v2 (`mindcraft.microbit-v2`) |
| Label(s)      | the on-tile text the author sees |

## Authoring

What the brain author writes and where it sits (a rule's `when` trigger, its `do`
section, or inline in a condition). Include a short fenced example.

## Arguments / modifiers

Tiles declare their argument grammar with the core call-spec combinators
(`packages/core/src/runtime/call-spec.ts`); `mkCallDef` flattens the grammar tree into a
fixed, position-indexed **slot array** the runtime body reads by id. Author-facing grammar,
runtime-facing slots. Principles (see the sim `move`/`see` tiles for worked examples):

- **Combinators:** `bag(...)` unordered (the usual top level), `seq(...)` ordered,
  `choice(...)` exactly-one (mutual exclusion), `optional(x)` zero-or-one,
  `repeated(x,{min,max})` repetition, `conditional(name, then, else?)` includes args only
  when a *named* sub-spec matched (context-sensitive availability).
- **Two arg kinds:** `mod(id)` = a modifier (keyword flag, no inline value); `param(id,
  {anonymous, required, name})` = a typed value (anonymous = no label, typed inline).
- **Repeated modifiers carry magnitude:** a repeated `mod`'s slot holds its **count**, and
  the body scales by it (e.g. "quickly quickly" = faster). Stacking is a real affordance.
- **Defaults live in the body, not the grammar:** the grammar marks things optional; when a
  slot is absent the exec function picks the default behavior.
- **The body never hardcodes indices:** it resolves `getSlotId(callDef, Tile)` once at
  module load, then reads with `hasArg(args, slot)` / `extractNumberValue(args.get(slot))`.
- Tile metadata is exported separately from the grammar as `modifiers[]` / `parameters[]`
  (id, label, iconUrl, dataType, anonymous/hidden).

Summarize the resulting slots:

| Slot | Name | mod/param | Type | Required | Anonymous | Default |
| ---- | ---- | --------- | ---- | -------- | --------- | ------- |

## Behavior

State the **stance bucket** and why, then the runtime semantics:

- **Sensor:** poll-derived (read the latest state each tick) or the event exception
  (justify against the 6i bus-listener hazard). Edge vs level. Firing model (fires once
  per occurrence vs evaluated continuously). If events are derived from polled state,
  describe the derivation.
- **Actuator:** sync (instantaneous, returns immediately) or async (allocates a pending
  handle, the rule `AWAIT`s and parks until completion, does not re-fire while parked).
  State concurrency behavior (serialize / reject / overlap).
- Composability: if non-inline, say so and why (e.g. why a combined tile exists instead
  of composing simpler ones).

## Timing / derivation

(Guidance: anything time- or state-dependent is pinned in the **microbit-v2 target
layer** - the wodal module is the oracle, the C++ port mirrors it, goldens enforce the
match - **not** core `vm-contract.md`. All timing is against the VM's logical tick time,
never wall-clock or animation-frame time. Use one of:)

- **Actuator completion formula** (async): the closed form for the completion tick.
- **Sensor derivation** (poll): the state machine + thresholds; thresholds are
  tick-expressible (the think loop is ~16 ms, which bounds resolution).
- **n/a** for an instantaneous sync tile.

## Device and trace

- **Device port:** the port method(s) the tile calls (read for a sensor poll, effect for
  an actuator).
- **Injectable input** (sensors): the deterministic value/event a parity test scripts in
  (the per-capability "injectable input" from the CODAL inventory) - required for a sensor
  read to be trace-parity-checkable.
- **Observable trace** (target contract, state the format version): the line(s) emitted
  when the tile crosses the port / fires.

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors it.
- Golden fixtures (name them): `<fixture>.mcprogram.bin` + `<fixture>.ticks.trace`,
  byte-compared by the C++ parity test.
- For sensors, the scripted injectable-input schedule that drives the golden.
- For async actuators, the `maxHandles` budget (a Locked Decision 7 runtime guard sized
  against the device budget, never a pool size).

## Open questions

(Draft-only. Each unresolved decision that blocks normative status; delete the section
once empty.)
