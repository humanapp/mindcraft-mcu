# Spec: filters (WHEN-side signal filters)

A core, target-agnostic tile-language feature: a new tile category for transforming a rule's
firing signal on the WHEN side.

## What a filter is

A **filter** is a **unary signal transform placed on the WHEN side of a rule, after a
sensor**. It consumes the preceding signal and produces a transformed signal; the rule fires
on the final signal of the chain:

```
WHEN  <sensor>  <filter>  [<filter> ...]   ->  rule fires on the final signal
```

Examples:

```
WHEN gesture tilt-left toggle      // each tilt-left toggles a held on/off bit
WHEN logo pressed latch            // a press goes true and the latch holds it
WHEN gesture shake once            // fire once per shake (a single-tick pulse)
WHEN see carnivore invert          // fires while NOT seeing a carnivore
```

Category properties:

- **WHEN-side only.** Filters are not valid in a rule's `do` / actuator position.
- **Top-level, never in an expression.** A filter post-processes the rule's signal; it does
  not embed inside boolean/value expressions.
- **Transforms, does not originate.** A filter operates on the signal it is given; with no
  preceding signal it is invalid (it cannot be the sole WHEN element). This includes a child
  rule whose WHEN holds only a filter: the empty-WHEN ancestor fall-through supplies a
  rule's WHEN *result*, not its firing signal, so a filter cannot transform an ancestor's
  signal and an empty-WHEN-plus-filter child is invalid.
- **Unary on the signal** (one signal in, one out) - and a filter **may also take its own
  arguments** (modifiers + parameters), distinct from the signal (see Arguments).
- **Chainable (pipeline).** Multiple filters compose left-to-right; order is significant.
  There is no chain-length cap. Each chain position is its own call site: two `toggle`
  filters in one chain hold two independent bits.
- **May be stateful** (per call site): `once`/`latch`/`toggle` keep a bit; the timing
  filters keep timestamps; `invert` is stateless. State lifecycle is uniform (see State
  lifecycle).
- **Synchronous.** A filter evaluates within the think and never parks - no handles, no
  await. The WHEN side is a per-think sampling of the signal; time-dependent behavior is
  expressed by the timing filters sampling the current time, and completion-driven
  behavior is ordinary rule sequencing (an awaited actuator parks only its own rule's
  fiber; the actions and child rules after it run on completion while other rules
  continue concurrently).

## The signal model

The WHEN side evaluates to a **value**; truthiness - or presence, for presence-gated
sensors - is applied at the WHEN boundary, and the rule's **WHEN result** captures the
pre-truthiness value. Filters insert **between the sensor's value and that boundary**: each
filter consumes the upstream signal (the value together with its truthiness/presence) and
produces the chain's next signal. The final signal decides whether the rule fires.

### The WHEN result of a filtered rule

- On a firing tick where the upstream value is **currently present**, the upstream value
  passes through unchanged as the rule's WHEN result. (`once` fires on the rising edge -
  the tick the value arrives - so the value is present and delivered.)
- On a firing tick with **no current upstream value** - a held `latch` after the input
  fell, an `invert` firing because nothing is there - the WHEN result is **absent**.
- A filter therefore **preserves the upstream result type, weakened to maybe-absent**. A
  consumer that declares a required WHEN-result type is compatible with a filtered WHEN
  exactly when it is compatible with the upstream type - except under `invert`, which fires
  precisely when no value is present, so a required-type consumer under `invert` is
  rejected.

## Filters are regular intrinsics over the action calling convention

Filters are **regular intrinsics**, not a closed set of fixed native primitives. The
mechanism is the **bytecode-action calling convention** - the same convention conversions
ride: slot-indexed arguments via the core call-spec grammar, per-call-site state keyed by
`callSiteId`, `ctx` access (time, variables), and a body that may be a host function or
bytecode, per filter. A filter body has the full capability of the language. No new opcode
and no VM-contract change: the brain compiler emits the filter as an action-convention call
that consumes the upstream signal and produces the transformed signal.

Because the convention is bytecode-capable by construction, user-defined filters are a
future registration surface over the same convention (deferred; see Deferred).

## Arguments (modifiers + parameters)

A filter **takes arguments just like a sensor does** - modifiers and parameters, declared
with the same core call-spec grammar (`bag`/`choice`/`optional`/`mod`/`param`, slot-indexed
via `mkCallDef`). A filter's full runtime inputs are: the upstream signal, its own
slot-indexed arg buffer, its per-call-site state, and `ctx`. Built-ins may take no
arguments (`invert`) or some; the mechanism supports them uniformly.

## Built-in filters

The calling convention is the substance; each built-in is small. The core set has two
families.

**Logic, edge, and memory:**

- **`invert`** - stateless logical NOT of the signal (fires while the input does not).
- **`once`** - a one-shot monostable: **fire once** when the input goes true - a
  single-tick pulse on the rising edge, then false until the next rising edge. Converts a
  level into a fire-once edge. Per-call-site state (the previous input level).
- **`latch`** - **hold**: go true on the input's rising edge and stay true until the page
  (re-)activates (see State lifecycle). Per-call-site state.
- **`toggle`** - **alternate** a held bit on each rising edge (on, off, on, ...): a T
  flip-flop. Per-call-site state (the bit).

**Timing** - each takes a single duration parameter and samples the current time; the trio
is orthogonal (require-before / extend-after / suppress-after):

- **`sustained <duration>`** - true only after the input has been **continuously true for
  the duration** (a long-press / held-steady detector). Per-call-site state (the rising
  timestamp). This is the general form of per-sensor "held" semantics.
- **`linger <duration>`** - keep true for the duration **after the input goes true** (a
  retriggerable pulse stretcher): makes momentary events - an impact, a shake - actionable
  for a window. Per-call-site state (the last-true timestamp).
- **`cooldown <duration>`** - after passing a firing, **suppress for the duration** (a
  rate limit). Per-call-site state (the last-passed timestamp).

A pass-through `level` is the identity (the raw signal) and needs no filter.

## Compositions

The set is kept small by composition; these idioms are part of the design, not accidents:

- **Falling edge**: `invert` then `once` fires exactly once when the signal *ends*
  (`WHEN button A pressed invert once` - on release).
- **Until**: `latch` then `invert` is true *until the first occurrence*
  (`WHEN see food latch invert` - while food has never been seen this page).
- `toggle` or `latch` directly after `once` is unchanged (both are edge-triggered
  already); the chain is legal and the `once` is a no-op.

## State lifecycle

**All per-call-site filter state resets when the rule's page (re-)activates.** This is the
one lifecycle rule for the category: `once` forgets its previous level, `toggle` clears its
bit, `latch` releases its hold, and the timing filters forget their timestamps. A `latch`
therefore holds until page re-entry; a duration/clear parameter is deferred design (see
Deferred).

## Enforcement

The category rules are compile-time validations, and the picker agrees with the compiler:

- The compiler rejects, with error-severity diagnostics: a filter outside the WHEN side; a
  filter with no preceding signal (the sole-WHEN-element and empty-WHEN-child cases); a
  required-WHEN-result consumer whose result availability the filter removes (`invert`).
- The picker offers a filter tile only where the compiler accepts it, and the
  suggestion-compiler consistency oracle covers the category in both directions.
- **Degraded documents:** a rule containing an unresolvable (missing-placeholder) filter
  tile does not fire. A filter silently dropping out of a chain would change firing
  semantics, so degradation is fail-safe rather than pass-through.

## Relationship to per-sensor edge/level modifiers

Filters subsume the per-sensor edge/level question: every sensor emits its one natural
(level) signal and `once`/`latch`/`toggle`/`invert` handle triggering uniformly. This
overlaps the button `held`/`pressed` modifiers. Stance: **coexist** - per-sensor modifiers
for ergonomics, filters for power - with **canonical** (filters as the one mechanism, one
signal per sensor) as the north star.

## Scope

Core language, target-agnostic, and a shared-surface feature for **both product apps**
(the micro:bit product and the sim/game product): brain compiler + language service +
editor tile category + the built-in intrinsics on each platform's runtime. Independent of
the device-surface work; sensors ship with their natural signal and filters layer on.

## Defining filters in ts-code (deferred surface; shape specified now)

User code defines a filter the way it defines sensors, actuators, and conversions: a
`Filter({...})` config, registered over the same action convention as the built-ins.

```ts
export default Filter({
  name: "debounce",
  icon: "wave-square",
  docs: "Passes the signal only after it has held steady for the window.",
  args: [param("window", { type: NumberType })],
  onSignal(ctx: Context, signal: boolean, args: { window?: number }): boolean {
    // returns the transformed signal
  },
});
```

`Filter` carries the same identity and presentation members as the other tile configs:
the auto-minted stable `id?`, `name`, and optional `label`, `icon`, `docs`, and `tags`,
feeding the picker and the docs panel exactly as they do for sensors and actuators.

- **`onSignal(ctx, signal, args) -> boolean`.** The body receives the upstream signal as a
  boolean - the truthiness/presence bit - plus `ctx` and the slot-indexed args. The body
  never sees or alters the upstream *value*: WHEN-result pass-through is runtime machinery
  (see The WHEN result of a filtered rule), so a filter body cannot violate the
  result-delivery rules.
- **Synchronous.** `onSignal` returns the signal directly; a filter is evaluated inside
  the WHEN and never parks (no `Promise`, no handles). An `async` or Promise-returning
  `onSignal` is rejected with a precise diagnostic.
- **State** uses the established user-code scoping: module-level `let` is per-call-site,
  which gives each chain position its own state with no new mechanism. Reconciliation to
  settle when this surface is built: the category's page-re-entry reset must hold for
  user-defined filter state too, so per-call-site module state in a filter body resets on
  page (re-)activation - whether that is the general user-code lifecycle or a
  filter-specific reset is the open design point.
- Declaration, extraction, ambient typing, and diagnostics follow the same conventions as
  the other user-code tile configs, including a precise diagnostic for any config the
  surface cannot support.

## Deferred

- **User-defined filters** - the `Filter({...})` surface above; the built-ins ship first
  and the convention is bytecode-capable by construction, so the surface is a registration
  feature when a real library consumer needs it. `debounce` (pass changes only after the
  signal has held steady for a window) is the canonical user-defined example and is
  deliberately not core.
- **`every <n>`** - fire on every Nth rising edge (a divider). Real but has no named
  consumer yet; a small parameterized filter whenever one appears.
- **`sometimes` / probability** - pass a firing with probability p. High play value, but
  it requires a deterministic seeded random service in the VM contract (both VMs must
  produce identical traces), so it waits on that service existing.
- **`latch` duration/clear parameter** - reset-after-a-duration or an explicit clear
  affordance, layered on the page-re-entry base semantics.
- **Canonical migration** of per-sensor edge/level modifiers (the button `held`/`pressed`
  rework), per the coexist stance above.
