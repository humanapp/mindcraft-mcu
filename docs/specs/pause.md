# Spec: pause (core actuator)

**Core, target-agnostic** (available on every device profile, like `yield`/`switch-page`), not a
microbit-v2 tile.

## Identity

| Field         | Value |
| ------------- | ----- |
| Kind          | actuator |
| Stance        | async / awaited actuator (temporal) - suspends the calling fiber for the duration |
| Composability | rule action (placed in `do`) |
| Tile key      | core `pause` (label "pause"; key format per the existing core actuators) |
| Action id     | TBD - appended at the next free **core** host-action id (after the 0-7 range) |
| Module        | core (`wendoo` core), all targets |

**First async core host action.** Every existing core host action is sync (`isAsync: false`,
op 44 `HOST_ACTION_CALL`); `pause` is the first with `isAsync: true` (op 45
`HOST_ACTION_CALL_ASYNC` + `AWAIT`, the scroll dispatch shape) - see Behavior.

## Authoring

A rule `do`-action that pauses the rule's fiber for a duration, then continues:

```
do: pause            // 1 second (default)
do: pause 2          // 2 seconds
do: scroll "hi"
    pause 0.5
    clear
```

## Arguments

One optional, anonymous **Number** - the duration in **seconds**.

| Slot | Name       | Type   | Required | Anonymous | Default |
| ---- | ---------- | ------ | -------- | --------- | ------- |
| 0    | (duration) | Number | no       | yes       | `1`     |

Absent/nil duration -> default `1` second. Fractional seconds allowed (e.g. `0.5`).

## Behavior

- **Async actuator:** dispatch allocates a pending handle, records the completion time, and
  returns the handle; the rule `AWAIT`s it and parks until the duration elapses (the
  temporal-actuator stance; same op-45 + AWAIT path as `display.scroll`). While parked the
  rule does not re-fire.
- **Completion = first think with VM tick `time` >= `start + duration*1000` ms** - logical
  tick time, never wall-clock. Resume joins the next round (handle-resumes-next-round).
- Pure time delay - no geometry (unlike scroll's formula); the completion is core, not
  target-specific.

## Timing

```
completionTimeMs = startTimeMs + round(durationSeconds * 1000)
```

Against the VM's logical tick `time`. Tick granularity (~16 ms on microbit-v2) bounds
resolution; a sub-tick duration resumes on the next think.

## Device and trace

- No device port (pure scheduler/time). Trace: the async action line
  (`action <id> site <cs> args <argc> <vals> async`); no port line.

## Conformance

- Core; both VMs; a golden brain that pauses, driven by a scripted tick schedule,
  byte-matched. Reuses the existing async-handle machinery + the bound resolver.

## Implementation notes / opens

- **Time itself is already available - no new time service needed.** The `ExecutionContext`
  already exposes `ctx.time` / `ctx.dt` / `ctx.currentTick` (updated before each `think()`);
  the core `timeout` sensor already reads `ctx.time + delay*1000`. `pause` reads `ctx.time`
  the same way (it is the harness-fed logical tick time, so parity holds).
- **The new mechanism is resume-at-time async-handle resolution.** Unlike `timeout` (a sync
  sensor that re-checks `ctx.time` each tick and never suspends), `pause` **suspends a fiber
  on a handle** and must be woken. Scroll's handle was settled by a device-port poll (target
  layer); `pause` has no device, so the **core runtime must settle pending pause handles in
  `think()`** when `ctx.time` >= their completion (track pending timed handles, resolve them
  in the drain step). Confirm this mechanism.
- **Requires `maxHandles > 0`** on any profile that uses `pause` (it holds a handle while
  parked). microbit-v2 has 8; a profile with `maxHandles = 0` cannot use `pause`.
- **Edge cases to pin:** `duration <= 0` -> resume next round (degenerate to a one-tick
  yield) or no-op; nil -> the 1 s default (above).
