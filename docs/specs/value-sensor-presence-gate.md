# Spec: value-sensor presence gate

A general brain-language mechanism so a **value-bearing event sensor** can fire its rule on a valid
but *falsy* value (0, "", false, empty collection). This is a language/VM-contract concern, not a
device feature; the bytecode contract lives in the VM contract
(`external/mindcraft-lang/docs/specs/contracts/vm-contract.md` until this repo owns a local copy).

## Problem

A rule's WHEN side produces a value. The VM captures it into the reserved `__whenResult` rule variable
(delivered to the DO side) and gates DO on `isTruthy(whenResult)`. For a **value-bearing event
sensor** - one that delivers a data value when it fires and signals "no value this think" by returning
**nil** - a valid but falsy value (the number 0, the empty string, false, an empty list) fails the
truthiness gate, so the rule does **not** fire even though the sensor fired. The truthiness gate
conflates "no event" (nil) with "an event carrying a falsy value" (0 / ""). The first case to hit this
is a radio receive of the number 0.

## The two WHEN gate modes

- **Truthiness gate (default, unchanged).** DO runs if `isTruthy(whenResult)`; nil / false / 0 / "" /
  empty collection all skip. This is the gate for boolean conditions and for any WHEN expression.
- **Presence gate (new).** DO runs if `whenResult` is **present** (not nil). A delivered value of 0 /
  "" / false fires; only nil (absent) skips. This is the gate for a bare WHEN that is exactly a
  presence-gated value sensor.

Both modes capture `__whenResult` identically (the WHEN-side final value); only the skip condition
differs, so the value (including 0) reaches DO unchanged in both.

## Mechanism

- **A new opcode `WHEN_END_PRESENT` (= 74)** mirrors `WHEN_END` (same one signed i16 skip-offset
  operand) but skips when the WHEN-result is **nil** rather than when it is falsy. `WHEN_END`
  (truthiness) is unchanged, so existing compiled programs are byte-unchanged. The brain compiler
  emits `WHEN_END_PRESENT` only for the bare-presence-gated case; every other rule emits `WHEN_END` as
  today. (A new opcode, not a new operand on `WHEN_END`, precisely so existing `WHEN_END` encodings -
  and therefore existing golden bytecode - do not change.)
- **A `PresenceGated` capability (`CoreCapabilityBits.PresenceGated = 2`)** marks a sensor as a
  value-bearing event sensor. One bit, two declaration surfaces:
  - **Built-in tile sensors** set the bit in the sensor def's `capabilities` BitSet.
  - **TypeScript sensors** declare `capabilities: [PresenceGated]` in the sensor's `SensorConfig`; the
    ts-compiler forwards it onto the generated user-tile def's BitSet. It is **declared, not inferred**
    from the return type - explicit and discoverable in the authoring API.
- **Brain-compiler detection.** When compiling a rule's WHEN, if the WHEN's root expression is exactly
  a sensor whose tile def carries `PresenceGated`, emit `WHEN_END_PRESENT`; otherwise `WHEN_END`. A
  presence-gated sensor used **inside an expression or compound** (e.g. `(sensor) > 100`,
  `(sensor) and X`) is not bare - the WHEN-result is the expression's value, gated by truthiness as
  usual, and the sensor's value flows into the expression normally.

## Runtime contract for a presence-gated sensor

A presence-gated sensor returns **nil** when there is no value this think (absent), and the value
(including 0 / "") when there is. nil means absent and nothing else: the sensor's value domain must
exclude nil. The capability and this contract are a pair - declare `PresenceGated` **and** return nil
for absent.

This pairing is an **author-honored contract, not compiler-enforced** - the same posture as built-in
host sensors. Declaring `PresenceGated` does not require the TS sensor to declare a nullable return
type, so a sensor that declares the capability but can never return nil (e.g. a `: number` return)
simply fires every think (it can never signal absence). This is benign and observable, not corrupting.
The authoring JSDoc documents "return null for absent." A diagnostic that requires a nullable return
when `PresenceGated` is declared is a deferred guardrail - revisit only if misuse surfaces (adding it
re-introduces the return-type analysis the capability declaration was chosen to avoid).

## `__whenResult` and determinism

- `__whenResult` capture is unchanged; DO reads the delivered value (including 0) via `__whenResult` or
  an explicit value slot (the `scroll` / `radio send` convention).
- The gate mode is a static, compile-time property of the rule (which opcode the compiler emitted);
  both VMs apply it identically. No new nondeterminism.

## Backward compatibility

Only sensors that opt in (set `PresenceGated`) change behavior. Existing sensors stay truthiness-gated,
no rule emits `WHEN_END_PRESENT` unless its WHEN root is a presence-gated sensor, and existing compiled
goldens are byte-unchanged. (Note: a numeric reading sensor such as the accelerometer is *not*
presence-gated - it always has a value, so it keeps truthiness semantics unless explicitly opted in.)

## Consumers

The radio receive sensors (`radio receive number` / `radio receive string`) are presence-gated, so
receiving 0 or "" fires the rule. Future value-bearing event sensors opt in the same way.
