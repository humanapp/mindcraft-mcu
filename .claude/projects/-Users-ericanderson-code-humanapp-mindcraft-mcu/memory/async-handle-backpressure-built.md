---
name: async-handle-backpressure-built
description: Async dispatch parks-and-retries on handle-table exhaustion instead of faulting; both VMs, built 2026-07-04
metadata:
  type: project
---

Async-handle backpressure BUILT both VMs 2026-07-04 (kickoff). An async dispatch
that cannot allocate a handle (HandleTable full) now PARKS the fiber and retries
the identical instruction next think, instead of faulting StackOverflow. Bounds
live handles to `maxHandles` at any same-think async breadth; loses no action.

Mechanism: `HandleTable.hasCapacity()` (non-mutating) added both VMs. The 3 async
ops (`execHostCallAsync` / `execActionCallAsync` / `execHostActionCallAsync` in
vm.ts; the matching `HOST_CALL_ASYNC` / `ACTION_CALL_ASYNC` /
`HOST_ACTION_CALL_ASYNC` cases in cpp vm.cpp) check capacity AFTER the structural
validations but BEFORE any side effect (arg pop, `createPending`, child spawn,
`execAsync`, pc++); when full they return `YIELDED` / `RunResult::yielded()` with
pc UNCHANGED. Re-entrancy: nothing consumed on the failed attempt, so the
re-enqueued fiber re-executes exactly. A drained child that backpressures routes
to the NEXT round (handles free only across thinks) via the existing
`routeSliceResult`/`runFiberSlice` YIELDED path. No opcode/bytecode-format change.

`maxHandles` threaded through `BrainRuntime` ctor -> VM options (was omitted; only
needed to set a small cap in tests). cpp `HandleTable::size()` added (mirrors TS)
for stress observability.

Golden: `async-handle-backpressure` (wodal fixtures + cpp trace-parity case) --
real compiled brain, parent + 8 scroll children, cap 4, waves [4,3,1], no fault,
byte-matched both VMs. Unit: `vm-handle-backpressure.spec.ts` (core). Stress:
`fiber-stress.test.cpp` wide-async case (12 children, cap 4, 4000 thinks,
ASAN-clean). Contract updated in the consumed checkout vm-contract.md.

Gates green: core 967, wodal 314, cpp check.sh (debug/release/sanitize). Real
device `maxHandles`=8.

FINDING (deferred, out of kickoff scope): the wodal runtime.ts does NOT thread
`deviceProfile.maxHandles` into `BrainRuntime`, so the TS wodal runtime uses the
VM default 100000 while cpp enforces the device 8 -- a latent parity gap for
brains with async breadth 9..100000 (below-cap brains are unaffected; all goldens
byte-match because they set the cap explicitly or stay small). Fixing it surfaces
backpressure in the product; the kickoff defers maxHandles tuning.

Detail [[per-rule-fiber-execution-model]] (same-think cascade this backpressures),
[[when-result-capture]].
