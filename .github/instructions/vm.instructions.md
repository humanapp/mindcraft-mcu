---
applyTo: "{docs/specs/contracts/vm-contract.md,packages/wodal/**,apps/microbit-sim/**,cpp/**}"
---

<!-- Adapted from external/mindcraft-lang/.github/instructions/vm.instructions.md -->

# Mindcraft VM Contract

The Mindcraft VM is a stack-based bytecode virtual machine with fiber-based
concurrency and async handles. The TypeScript reference implementation lives in
`external/mindcraft-lang/packages/core/src/runtime/`.

## Contract Source

The bytecode compatibility contract lives at
`external/mindcraft-lang/docs/specs/contracts/vm-contract.md` until this repo
owns a local copy. When this repo adds `docs/specs/contracts/vm-contract.md`,
that local file becomes the active contract anchor for MCU work.

The TS expression of opcode numeric assignments is
`external/mindcraft-lang/packages/core/src/runtime/bytecode.ts`.

When changing an opcode, operand semantic, value semantic, host calling
convention, handle behavior, or error code, update the VM contract in the same
unit.

## Execution Model

- Stack-based bytecode VM with fibers.
- Budget-limited execution: each fiber has an instruction budget decremented per
  instruction.
- Single-threaded runtime entry: one fiber runs at a time.
- External callbacks enqueue only. The host loop drains queues, resolves
  handles, schedules fibers, and executes VM entry points.
- Async operations return handles; `AWAIT` suspends the current fiber only while
  the handle is pending.

## Key Reference Files

All files below are under `external/mindcraft-lang/packages/core/src/runtime/`
unless noted otherwise.

- `vm.ts` - `VM` class and `FiberScheduler`
- `vm-types.ts` - `Fiber`, `Frame`, `FiberState`, `HandleTable`, scheduler
  interfaces, and related types
- `bytecode.ts` - `Op` enum, `FunctionBytecode`, `ConstantPools`, instruction
  encoding
- `program.ts` - `Program` and `ProgramArtifact` interfaces
- `host-bindings.ts` - linked program and page metadata shapes
- `context.ts` - `ExecutionContext`, host and bytecode action bindings
- `services.ts` - nested `PlatformServices` aggregate and sub-service
  interfaces
- `value.ts` - `Value` tagged union and singleton constants
- `brain-runtime.ts` - brain runtime orchestration and `think()` loop

## Compatibility Rules

- TypeScript and C++ VMs must be bytecode-compatible. The file format may
  differ, but decoded semantics must match.
- The compiler is target-unaware. It emits the same bytecode regardless of the
  eventual runtime target.
- Runtime feature flags must not create opcode subsets. Every conforming VM
  implements every opcode in the contract.
- Host/platform differences are expressed through registered host functions,
  actions, ABI manifests, resource caps, and platform adapters.
- Platform callbacks must not re-enter `brain.think()`, `scheduler.tick()`,
  `runFiber()`, or async handle resolution directly.

## Host Calling Convention

- Host calls use positional arg buffers.
- `argc` is the arg buffer width.
- `callSiteId` keys per-callsite state.
- Missing optional slots are represented as `NIL_VALUE`; there is no separate
  presence map.
- Sync host calls receive an ephemeral stack view.
- Async host calls receive an owned snapshot plus a `HandleId`.
- Every async host call must eventually resolve, reject, or cancel its handle.

## WODAL and Microbit Sim

- `packages/wodal` must model device/runtime mechanics without depending on the
  browser app UI.
- `apps/microbit-sim` may visualize device state and orchestrate project/UI
  workflows, but reusable simulated device behavior belongs in WODAL.
- WODAL should model CODAL-style event and fiber mechanics through queues and
  host-loop drains, preserving the VM single-entry rule.
