# Tile spec: display scroll

Status: implemented (wodal). C++ mirror pending.

An example tile spec following the canonical template at `_template.md` (this was the
original seed for that template). It documents one async actuator: what a brain author
writes, how its arguments parse, what it does at runtime, and how its behavior is verified
byte-for-byte across the TypeScript and C++ VMs.

## Identity

| Field         | Value                                    |
| ------------- | ---------------------------------------- |
| Kind          | actuator                                 |
| Stance        | async / awaited actuator (temporal)      |
| Composability | n/a (a rule action, placed in `do`)      |
| Tile key      | `microbit-v2.display-scroll`             |
| Action id     | 1026                                     |
| Function id   | 1035 (`ActuatorDisplayScroll`)           |
| Module        | microbit-v2 (`mindcraft.microbit-v2`)    |
| Label         | "scroll text"                            |

Action and function ids are wire-stable: once assigned they are never changed or
reused.

## Authoring

A brain author places the scroll actuator in a rule's `do()` section. It scrolls
text across the 5x5 LED display, right to left, and the rule waits for the
animation to finish before continuing.

```
do: scroll "hello world"
```

## Arguments

One argument: the text to scroll.

| Slot | Name      | Type     | Required | Anonymous | Default   |
| ---- | --------- | -------- | -------- | --------- | --------- |
| 0    | (text)    | String   | no       | yes       | `"hello"` |

- The argument is **optional** and **anonymous**: a brain author types the text
  inline with no parameter label.
- When the call omits the text (the slot is absent or nil), the actuator scrolls
  the default text `"hello"`.

## Behavior

- The actuator is **asynchronous**: dispatch allocates a pending handle, starts
  the scroll, and returns the handle; the rule `AWAIT`s it and parks until the
  scroll animation completes. While parked, the rule does not re-fire.
- Concurrent scrolls **serialize**: a scroll requested while the display is busy
  starts when the display next becomes free, mirroring CODAL's
  `waitForFreeDisplay`.
- Completion resolves the handle, which resumes the awaiting rule on the
  following think (the handle-resumes-join-the-next-round rule).

## Timing

The scroll's completion time is a deterministic function of the text length,
the per-step delay, and the display geometry. It is pinned in the microbit-v2
target layer (`packages/wodal/src/targets/microbit-v2/mindcraft/display-scroll.ts`)
and mirrored by the C++ port; goldens enforce the match. It is target-specific
and is not part of the core VM contract.

```
stepsPerCharacter = displayWidth + spacing = 5 + 1 = 6
completionTimeMs  = startTimeMs + 6 * (characterCount + 1) * delayMs
```

`characterCount` is the text's UTF-16 code-unit length; the default per-step
delay is 120 ms. The `+ 1` is the trailing blank cycle that clears the last
character. The completion clock is the VM's logical tick time, never wall-clock
or animation-frame time.

## Device and trace

- Device port: the actuator calls a display scroll-text port method; the wodal
  simulated display and the C++ device port both run the CODAL-matching
  animation and drive completion from logical time.
- Observable trace (format version 1):
  - `port display scroll "<bytes>"` when the scroll crosses the display port.
  - `action <id> site <callSiteId> args <argc> <value>... async` for the async
    dispatch (the trailing `async` marks a handle return rather than a value).

## Conformance

- The wodal microbit module is the oracle; the C++ microbit-v2 port mirrors it.
- Golden fixtures live beside the wodal trace specs:
  `display-scroll.mcprogram.bin` and `display-scroll.ticks.trace`. The C++ VM
  parity test loads the same binary and byte-compares the trace.
- microbit-v2 registers a non-zero async-handle budget (`maxHandles`) sized
  against the device budget, a runtime guard, never a pool
  size.
