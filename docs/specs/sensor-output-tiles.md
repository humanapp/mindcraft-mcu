# Spec: Sensor output tiles

A sensor declaration may expose **output tiles**: multiple named, typed outputs from one sensor,
each surfaced as an inline value-tile that the user can drop into any value slot downstream of the
sensor. This lets one sensor supply many values to downstream logic, instead of the single value a
sensor delivers today.

Today a sensor yields exactly one value - the WHEN-side result captured into the reserved
`__whenResult` rule variable, read back by an argument-less DO actuator (the `getWhenResult`
mechanism; `scroll text` is the canonical consumer). That single, anonymous channel is limiting: a
received radio packet, for instance, carries a value, a name, a signal strength, a sender serial, a
system time, and a raw payload buffer - all facets of one event - but only one of them can reach
downstream logic, and only via `__whenResult`. Output tiles give a sensor a set of named output
ports, each usable anywhere downstream like an ordinary value (stored in a variable, compared,
passed as an argument).

This is a brain-tile language + editor feature. It adds **no VM opcodes, no runtime phase, and no
codec change**: outputs are written and read through the existing rule-variable host functions
(`RuleContextSetVariable` / `RuleContextGetVariable`), which both VMs already implement.

## Authoring surface

A sensor declaration gains an `outputs` field (sibling to `args` / `capabilities`):

- `outputs` - a list of output declarations, each with:
  - `name` - the output's identity (stable; used to derive the backing rule-variable key and the
    output tile id).
  - `type` - the output's value type (number / string / boolean / a struct / buffer ...). Becomes the
    output tile's `outputType` for editor compatibility.
  - `label?` / `icon?` / `docs?` / `tags?` - optional display + catalog metadata, exactly as for the
    sensor itself.

Inside `onExecute`, the sensor writes outputs with a `setOutput` helper - sugar over the rule-variable
setter, keyed to the namespaced output slot:

- `setOutput(ctx, name, value)` - write the named output for this fire.
- The author is responsible for **clearing stale outputs**: a sensor that does not always write every
  output should nil the ones it skips at the top of `onExecute` - `setOutput(ctx, name, NIL_VALUE)`.
  There is no framework auto-clear (output rule variables persist across thinks by the
  rule-variable lifetime rule; see Semantics). An output tile whose backing variable is nil yields nil.

## Usage sketch

**User-code form** (`Sensor({...})`, lowered by the ts-compiler):

```ts
const RadioReceive = Sensor({
  name: "radio receive string",
  capabilities: ["PresenceGated"],
  outputs: [
    { name: "value", type: "string" },
    { name: "rssi", type: "number", label: "signal strength" },
  ],
  onExecute(ctx) {
    // clear stale outputs first - this fire may not produce a packet
    setOutput(ctx, "value", NIL_VALUE);
    setOutput(ctx, "rssi", NIL_VALUE);

    const packet = ctx.microbit.radio.receiveString();
    if (packet === undefined) return NIL_VALUE; // presence-gated: absent -> rule does not run

    setOutput(ctx, "value", mkStringValue(packet.value));
    setOutput(ctx, "rssi", mkNumberValue(packet.rssi));
    return mkStringValue(packet.value); // gate value -> __whenResult
  },
});
```

**Built-in sensor form** (a host action: `outputs` declared on the `ActionDescriptor`, written in the
host `execSync` - this is how the radio sensors, which are built-in peripherals, declare them):

```ts
const descriptor: ActionDescriptor = {
  key: CoreHostActions.RadioReceiveString.key,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.String, // the gate value -> __whenResult
  outputs: [
    { name: "value", type: CoreTypeIds.String },
    { name: "rssi", type: CoreTypeIds.Number, label: "signal strength" },
  ],
};

function execRadioReceiveString(ctx: ExecutionContext): Value {
  // clear stale outputs first - this fire may not produce a packet
  setOutput(ctx, "value", NIL_VALUE);
  setOutput(ctx, "rssi", NIL_VALUE);

  const packet = ctx.microbit.radio.receiveString();
  if (packet === undefined) return NIL_VALUE; // presence-gated: absent -> rule does not run

  setOutput(ctx, "value", mkStringValue(packet.value));
  setOutput(ctx, "rssi", mkNumberValue(packet.rssi));
  return mkStringValue(packet.value); // gate value -> __whenResult
}

// registration attaches the owner gating capability (see Semantics); the output
// tiles are derived from descriptor.outputs the same way parameter tiles are
// derived from args.
const binding: HostActionBinding = { binding: "host", descriptor, id: CoreHostActions.RadioReceiveString.actionId, execSync: execRadioReceiveString };
```

In the editor, once `radio receive string` is the WHEN trigger, the picker offers the inline value
tiles `value`, `signal strength`, and `sender` anywhere downstream - the user stores `value` into a
variable, compares `signal strength` against a threshold, routes `sender`, etc.

## Semantics

- **One inline value-tile per declared output.** Each output auto-registers as a tile with
  `TilePlacement.Inline` and the declared `outputType` - the same tile category as the existing inline
  value-sensors (`random`, `current page`). The registration is derived from the `outputs`
  declaration, mirroring how parameter and modifier tiles are auto-generated from `args` today.
- **Surfaced only downstream of a providing sensor.** Output tiles are gated by the existing
  capability / requirement system, keyed by **output name**: each declared output name has a
  capability that every sensor declaring that name *provides*, and the single output tile for that
  name *requires* it. The picker offers an output tile when any sensor declaring it is present in the
  rule hierarchy (the same mechanism by which the `see` sensor makes the `it` literal available -
  generalized so that, e.g., both a `see` and a `hear` sensor can light up the same `it` output).
  Capabilities propagate across WHEN + DO and up the ancestor chain, so outputs are available
  throughout the rule and its nested child rules.
- **Backing: one shared rule variable per output identity.** An output's identity is its
  **(type, name)** pair, and its value lives in a rule variable keyed `__out.<type>.<name>` - NOT
  namespaced by owner. Two sensors that declare the same name AND type write the **same** variable and
  surface the **same** tile (sharing is the default and intentional; see "Shared outputs" below).
  Encoding the type in the key makes a same-name / different-type pair **non-colliding by
  construction** (two distinct variables, two distinct tiles) - no registration error needed.
  `setOutput` writes via `RuleContextSetVariable`; the output tile reads via `RuleContextGetVariable`.
  Both are existing core host functions (no VM change). The output tile compiles to a single
  `RuleContextGetVariable` call with the key as a constant.
- **Shared outputs (sharing by identity).** Output identity is `(type, name)`. Distinct sensors that
  declare the same identity share one variable, one tile, and one gating capability; whichever
  sensor's `onExecute` runs last in a think wins, and a nested rule's write shadows an ancestor's (the
  rule-variable ancestor walk). The `see`/`hear`/`it` case is exactly this: both declare `it` of type
  `TargetActor`, so both feed the one shared `it`. Notes: (1) a same name with **different** types does
  not collide (distinct keys, distinct tiles disambiguated by the consumer slot's expected type), but
  authors **should** avoid reusing a display name across types for clarity - it is discouraged, not an
  error; (2) the name space within a type is flat, so an output named `value` is shared by every sensor
  that declares `value` of that type - naming carries meaning, as for brain variables. To keep an
  output private, give it a distinct name (there is no per-owner opt-out mechanism).
- **Known rough edge: a child clears a shared output it is not writing.** Because `setOutput` writes
  the current rule's own store, a child rule that nils a shared output (`setOutput("it", NIL_VALUE)`)
  while routing its own logic to a *different* output creates a **child-local nil shadow** of `it`:
  for that child subtree, `it` now reads nil even though a parent rule wrote a fresh value (the
  parent's `it` is intact in the parent store; it is only shadowed for the child). The child author,
  clearing "the outputs I am not using," may not realize a parent passed a value through `it`. This is
  an accepted limitation - creative workarounds exist (don't clear a shared output you don't own; read
  before clearing), and the cost of engineering it away (framework-tracked ownership) is not worth it.
- **Readable downstream and in nested rules.** A rule variable written on the WHEN side is readable by
  every DO-side tile in the same rule and, via the rule-variable ancestor walk, by nested child rules.
  The owner sensor (normally the WHEN trigger) runs before the DO section, so DO-side output reads are
  fresh within the same think.
- **Freshness is author-managed.** Rule variables persist from first write until the brain shuts down
  (across thinks and page switches), so an output retains its last-written value until overwritten.
  An author who must not leak a stale value clears it at the top of `onExecute` (`setOutput(name,
  NIL_VALUE)`). An output tile reads whatever its backing variable currently holds; nil if never
  written or explicitly cleared. **For a shared output, prefer write-when-present:** only write the
  output when this sensor actually has a value, and do NOT blindly nil a shared output at the top of
  `onExecute` - a clear-then-maybe-write would let the last-running sensor wipe a peer's value in the
  same think. The nil-at-top clear is for outputs a sensor exclusively owns.
- **Compatibility.** An output tile carries its declared `outputType`, so the editor's
  Exact/Conversion/Unchecked compatibility offers it in matching value slots (including struct-field
  conversions) like any other value-producing tile.
- **No VM / runtime / codec change.** Writes and reads ride `RuleContextSetVariable` /
  `RuleContextGetVariable`, which both VMs already implement; the new work is the `outputs` authoring
  surface, the `setOutput` helper, the derived output-tile registration, the editor gating + render,
  and the brain-compiler lowering of the output tile kind to the existing rule-variable read.

## ABI anchors

- Backing rule-variable key: `__out.<type>.<name>` (rule-scoped; keyed by output identity = type +
  name; shared across all sensors declaring that identity; same name / different type does not
  collide).
- Core host functions reused (no new ids): `RuleContextSetVariable` (write), `RuleContextGetVariable`
  (read). The output tile lowers to a `RuleContextGetVariable` call with the key as a string constant.
- Gating: a per-**output-identity** ((type, name)) capability - every sensor declaring that identity
  provides it; the single output tile for that identity requires it. The bit is an edit-time concern
  (recomputed from tile defs at registration; not serialized into the saved brain), allocated above
  the reserved `CoreCapabilityBits` range.

## First consumer

The radio sensors are the motivating consumer and validate the feature end to end. The first cut
exposes two outputs on `radio receive string` and `radio receive number`:

- `value` - the delivered value (string for the string tile, number for the number tile). Distinct
  output identities (`value:string` vs `value:number`), so both tiles carry a `value` output without
  colliding.
- `signal strength` (`rssi`, a number) - carried on every received packet regardless of type.

These are pure output-tile additions with no radio wire-handling change. The remaining packet facets
stay Device-API-only for now: `sender` serial, `time` (system time), and the raw payload `buffer`.
A packet `name` is intentionally NOT a `radio receive string` output - in the MakeCode wire format a
name exists only on `VALUE` / `DOUBLE_VALUE` packets (named **numbers**); `STRING` packets are
nameless. Exposing `name` therefore depends on a separate radio enhancement: a value-pair receive form
(a tile matching `VALUE` / `DOUBLE_VALUE`), which output tiles would then decorate with `name` +
`value`. See `docs/specs/radio.md`.

## Open questions

- ~~**Read path / VM cost.**~~ RESOLVED: output tiles read via the existing `RuleContextGetVariable`
  core fn; no new VM/core-fn/codec work.
- ~~**Downstream-only scoping.**~~ RESOLVED: the existing capability / requirement gating (owner
  provides, outputs require), the same mechanism as `see` -> `it`.
- ~~**Stale values.**~~ RESOLVED: author-managed clear (`setOutput(name, NIL_VALUE)` at the top of
  `onExecute`); no framework auto-clear.
- **Output tile representation** - whether the auto-generated output tile is a new `BrainTileKind`
  ("output") or a specialized inline-sensor subtype. Either is brain-compiler/editor only; settle in
  the impl plan.
- **Per-output-identity capability allocation** - the exact scheme for minting and wiring the
  per-(type, name) gating bit at registration (edit-time, non-serialized; every declaring sensor
  provides it; the one output tile requires it). Settle in the impl plan.
- ~~**Shared-output staleness.**~~ RESOLVED (author discipline): for shared outputs, write-when-present
  and do not blindly nil at the top of `onExecute`; the nil-at-top clear is for exclusively-owned
  outputs. (An alternative framework clear-per-evaluation was considered and not adopted, to preserve
  the no-runtime-change property.)
