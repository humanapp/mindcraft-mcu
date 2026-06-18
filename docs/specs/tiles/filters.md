# Spec: filters (WHEN-side signal modifiers)

Status: CONCEPT / DRAFT (2026-06-17, design capture - not implementation-ready). Core,
target-agnostic tile-language feature. Captured now so the design can harden; the call
signature and the latch-reset semantics are open (see Open questions).

## What a filter is

A **filter** is a new tile category: a **unary signal transform placed on the WHEN side of a
rule**, after a sensor. It consumes the preceding signal and produces a transformed signal:

```
WHEN  <sensor>  <filter>  [<filter> ...]   ->  rule fires on the final signal
```

Examples (origin: scratch in `accelerometer-sensor.md`):

```
WHEN gesture tilt-left toggle      // each tilt-left toggles a held on/off bit
WHEN logo pressed latch            // a press goes true and the latch holds it
WHEN gesture shake one-shot        // fire once per shake (a single-tick pulse)
WHEN see carnivore invert          // fires while NOT seeing a carnivore
```

Category properties (decided across 2026-06-17 discussion):

- **WHEN-side only.** Filters are not valid in a rule's `do` / actuator position.
- **Top-level, never in an expression.** A filter post-processes the rule's signal; it does
  not embed inside boolean/value expressions.
- **Transforms, does not originate.** A filter operates on the signal it is given; with no
  preceding signal it produces nothing (it cannot be the sole WHEN element).
- **Unary on the signal** (one signal in, one out) - but a filter **may also take its own
  arguments** (modifiers + parameters), distinct from the signal (see Arguments).
  (Consequence: a pure unary-signal `latch` has no reset *signal* input - see Open questions.)
- **Chainable (pipeline).** Multiple filters compose left-to-right; order is significant.
- **May be stateful** (per call site): `one-shot`/`latch`/`toggle` keep a bit; `invert` is
  stateless.

## Key decision: filters are regular intrinsics (full language capability)

Filters are **regular intrinsics**, not a closed set of fixed native primitives. The
mechanism is the **normal function/calling machinery**, so a filter body has the **full
capability of the language** - locals, per-call-site state, `ctx` (time, variables),
control flow - which we will need for complex filters eventually. The built-in filters
(`invert`/`one-shot`/`latch`/`toggle`) ship as intrinsics over that same convention; nothing about
the mechanism is special-cased to them. (Whether a given built-in is implemented as a native
body or as a std-lib bytecode body is an impl detail; the **calling convention must support
bytecode filters** so arbitrary/complex - and eventually possibly user-defined - filters work
the same way.)

## Arguments (modifiers + parameters)

A filter **takes arguments just like a sensor does** - modifiers and parameters, declared with
the **same core call-spec grammar** (`bag`/`choice`/`optional`/`mod`/`param`, slot-indexed via
`mkCallDef`; see `_template.md` and the sim `move`/`see` examples). So a filter's full runtime
inputs are: the **upstream signal** (consumed from the stack) **plus its own slot-indexed arg
buffer** (its modifiers/parameters) plus per-call-site state. This is what lets complex
filters be expressive - e.g. a `hold <duration>` filter with a duration parameter, a debounce
filter with a window parameter, a `latch` with a `clear`-style modifier. Built-ins may take no
args (`invert`) or some; the mechanism supports them uniformly.

## Initial built-in filters

- **`invert`** - stateless logical NOT of the signal (fires while the input does not).
- **`one-shot`** - **fire once** when the input goes true: a single one-tick pulse on the
  rising edge, then false until the next rising edge (a monostable). Converts a level into a
  fire-once edge. Per-call-site state (the previous input level).
- **`latch`** - **hold**: go true on the input's rising edge and stay true. **Reset is the
  open question** (a unary latch has no reset signal - see below). Per-call-site state.
- **`toggle`** - **alternate** a held bit on each rising edge (on, off, on, ...): a T
  flip-flop. Per-call-site state (the bit).

These four cover the common edge/memory behaviors - fire-once (`one-shot`), hold (`latch`),
alternate (`toggle`) - plus `invert`; together they subsume the per-sensor edge/level
question (see Relationship below). A pass-through `level` is the identity (the raw signal) and
needs no filter.

## Call signature (OPEN - the load-bearing unknown)

A filter takes the **upstream signal** plus **its own arg buffer** (modifiers/parameters, per
Arguments above) and returns the output signal, with persistent per-call-site state and (for
complex filters) `ctx`. So the shape is roughly `filter(signal, args..., [ctx]) -> signal`.
Sketch options to decide:

- minimal: `filter(signal, args...) -> signal`, persistent state via the call-site-var
  mechanism (the `callSiteSlots` machinery, as buttons/timeout use).
- full: `filter(signal, args..., ctx) -> signal` - full `ctx` access (time, variables) for
  complex filters; this is what "full language capability" points to.

Lowering (likely, to confirm): the WHEN side already leaves the sensor's boolean on the
stack; the brain compiler emits a regular **function call** to the filter (passing the
signal), and the filter returns the transformed boolean - reusing `CALL` + per-call-site
state, **no new opcode and no VM-contract change**. The "acts on the stack" instinct = the
filter consumes the pushed signal and pushes its result.

## Relationship to per-sensor edge/level modifiers

Filters **subsume the per-sensor edge/level question**: every sensor emits its one natural
(level) signal and `one-shot`/`latch`/`toggle`/`invert` handle triggering uniformly. This
collapses, e.g., accelerometer Q1 (emit the natural gesture signal; let filters adapt). Tension: it overlaps the button `held`/`pressed` already
shipped. Decision to make: **coexist** (per-sensor modifiers for ergonomics + filters for
power; some redundancy) vs **canonical** (filters are the one mechanism; sensors emit one
signal; rework buttons eventually). Working stance: coexist near-term, canonical as the north
star.

## Scope

Core, target-agnostic (brain compiler + the filter calling convention + the built-in
intrinsics + a new tile category in the editor). Touches `external/mindcraft-lang` (core +
brain compiler). Independent of the device-surface work; sensors ship with their natural
signal and filters layer on whenever this lands.

## Open questions

1. **Latch reset.** A unary-signal `latch` has no reset *signal* input. Is the semantics "hold
   until the page (re-)activates," or does `latch` get a reset path? Now that filters take
   **arguments**, the reset could be a **parameter/modifier** on `latch` (e.g. reset-after-a-
   duration, or a clear condition) rather than a second signal input - keeping the unary-signal
   shape. Lead question - everything else is easier.
2. **Call signature** (above): minimal `bool -> bool` + call-site state, or full `ctx` access?
   The "full language capability" requirement argues for `ctx` access.
3. **Built-in set:** `invert`/`one-shot`/`latch`/`toggle` - all four at once, or a subset
   first?
4. **Coexist vs canonical** vs the per-sensor edge/level modifiers (above).
5. **User-defined filters:** in scope eventually (the "full capability" motivation), or
   built-in-intrinsics-only for now? Affects how general the calling convention must be on
   day one.
6. **Chaining limits / ordering rules:** any cap on how many filters chain; is order
   author-visible and meaningful (yes, by construction).
