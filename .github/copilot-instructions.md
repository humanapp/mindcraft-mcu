# Copilot Instructions

Before working in any area of the codebase, list `.github/instructions/` and
read `global.instructions.md` plus any files whose name matches the area you are
working in.

These instructions apply to all Copilot features, including inline tab
completions.

## Code Quality

- This code will be used for teaching; document exported APIs well enough that
  readers can understand them without external context.
- This is a production codebase; only suggest code that is correct, complete,
  and ready for production use.
- Never emit placeholder code. Do not use `TODO`, `FIXME`, `...`,
  `/* implementation */`, `throw new Error("Not implemented")`, or any other
  stub pattern unless the user has explicitly written a stub and is asking to
  fill it in.
- Never produce non-production statements such as `console.log("test")`,
  `console.log("here")`, hardcoded magic strings used only for debugging, or
  temporary workarounds presented as real code.
- Do not add comments that just restate what the code does. Only include
  comments that explain non-obvious intent, invariants, or constraints.

## Import Style

- Never use inline `import()` type expressions in `.ts` or `.tsx` files. Always
  use a top-level `import type` statement instead.
  - Exception: `.d.ts` ambient declaration files, if this repo later adds them.

## Naming and Layout Conventions

- Match the naming and placement conventions already established in the area
  you are editing when creating new files, directories, test files, generated
  artifacts, or other repo entries.
- Before creating a new file, inspect nearby siblings and follow the dominant
  local pattern for separators, casing, prefixes, suffixes, and test file
  naming.
- Do not introduce a new naming pattern to an area of the repo unless the user
  explicitly asks for it or an existing tool/framework requires it.

## Project-Specific Rules

### WODAL (`packages/wodal`)

- `packages/wodal` owns simulated microbit functionality and runtime mechanics:
  virtual device state, event queue, time, button/display APIs, sensor
  abstractions, host bindings, async completion plumbing, and deterministic
  tick/update behavior.
- Keep WODAL UI-independent. Browser rendering, project management, editor
  integration, and run controls belong in `apps/microbit-sim`.
- Model CODAL mechanics through a web runtime profile; do not expose
  browser-specific UI concepts from WODAL APIs.
- External events enqueue work. They must not call Mindcraft VM entry points
  directly or resolve handles outside the host loop.

### Microbit Sim App (`apps/microbit-sim`)

- `apps/microbit-sim` owns the browser product shell: visual microbit rendering,
  project management, compiler integration, artifact loading, run/pause/reset
  controls, and diagnostics.
- Do not duplicate simulated device behavior in the app. Add reusable device
  behavior to `packages/wodal`.

### VM Contract

- TypeScript and C++ VMs must remain bytecode-compatible. File encoding may
  differ, but decoded bytecode semantics must match
  `external/mindcraft-lang/docs/specs/contracts/vm-contract.md` until this
  repo owns a local `docs/specs/contracts/vm-contract.md`.
- All compilation and linking happen on the web/compiler side. Runtime packages
  must not introduce target-aware bytecode lowering.
- Preserve the Mindcraft host calling convention: positional arg buffers,
  callsite ids, async handles, and single-entry host-loop execution.
