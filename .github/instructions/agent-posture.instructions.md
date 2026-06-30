---
applyTo: "**"
---

# Agent Posture for Mindcraft MCU

This file captures the working temperament and decision style expected of agents
in this repository, especially for ambiguous work touching WODAL,
`apps/microbit-sim`, the C++ on-hardware VM (`cpp/`), or Mindcraft bytecode
compatibility.

It complements the enforceable rules; it does not restate them. The active
instruction sources remain `AGENTS.md`, `global.instructions.md`, and
`vm.instructions.md`. This document captures the judgment to apply where those
leave a decision open.

## General Posture

Work as a careful engineering collaborator, not a code generator trying to
maximize diff size. Move the system forward in small, reviewable steps while
preserving the architectural boundaries that make the project viable.

Default to these habits:

- Read before proposing.
- Propose before editing when the next step is architectural or ambiguous.
- Keep each implementation slice narrow.
- Prefer one coherent seam over several speculative scaffolds.
- Name uncertainties explicitly.
- Stop at a design note when the right code boundary is not clear.
- Verify with focused checks after changes.

Avoid these failure modes:

- Large opportunistic rewrites.
- Scaffolding future features not needed for the current slice.
- Turning exploratory architecture discussion into committed implementation.
- Hiding missing contracts behind placeholder code.
- Treating WODAL as an app UI dependency.
- Treating `apps/microbit-sim` as the owner of simulated device semantics.
- Letting the C++ VM (`cpp/`) diverge from the TypeScript reference VM's
  observable semantics.

## Small-Step Workflow

For non-trivial work, use this sequence:

1. Read the relevant instructions and files.
2. Summarize the current shape in concrete terms.
3. Identify the smallest coherent next slice.
4. State the ownership boundaries and invariants involved.
5. Wait for confirmation when the slice is not already explicitly requested.
6. Implement only that slice.
7. Run the narrowest meaningful checks.
8. Report what changed, what was verified, and what remains.

Small does not mean superficial. A small step should still be complete at its
level: a parser slice includes stable diagnostics and tests; a runtime slice
preserves execution boundaries and state ownership.

## Boundary Discipline

Be critical about where code belongs.

`packages/wodal` owns:

- CODAL-inspired web device runtime behavior.
- Simulated microbit functionality.
- WODAL device profiles.
- WODAL target metadata parsing.
- WODAL program image artifacts.
- Runtime loading mechanics.

`apps/microbit-sim` owns:

- Visual rendering.
- Project UI.
- Browser product shell.
- User workflows.
- Integration wiring between project state, compiler output, WODAL runtime
  state, and visual controls.

`cpp/` owns:

- The native C++ on-hardware Mindcraft VM and the micro:bit v2 device firmware.
- Bytecode-compatible mirroring of the TypeScript reference VM's observable
  semantics. The reference VM is the executable spec; `cpp/` must not diverge
  from it.
- Device firmware mechanics: the on-flash program region, the CODAL host-loop
  driver, and fault-mode policy.
- The hand-maintained C++ ABI id mirror headers, kept append-only and in sync
  with their TS-declared id spaces.
- The native memory model: one region arena plus typed pools, no pre-sized
  buffers, no process-global mutable state.

Shared Mindcraft packages own:

- Product-level document contracts.
- Shared service APIs.
- Compiler/runtime contracts that apply across Mindcraft targets.

When a module could plausibly fit in more than one place, prefer the owner with
the narrowest durable responsibility. If a shape is a product-level contract, do
not bury it in WODAL just because WODAL is the first consumer.

## WODAL Direction

WODAL is the CODAL-inspired web device runtime for Mindcraft MCU. It should
remain adapter-shaped: it exposes runtime/device behavior that app layers
consume, but it must not know about app UI or project screens.

Mutable runtime state must be scoped to explicit runtime/device/environment
instances. Do not introduce process-global mutable state or singletons. A
process may host multiple Mindcraft platforms and multiple WODAL runtimes.

## Project Contract Posture

Treat shared project documents and artifact formats as Mindcraft product
contracts, not one-package implementation details. When project or artifact data
can be consumed by more than one package, put the common contract in a shared
package or design doc before binding it to one implementation. WODAL can own
WODAL-specific target metadata and artifact validation, but it should not
silently become the owner of the whole product file format.

## Error and Diagnostic Posture

Errors and diagnostics should be machine-readable first. Use stable constants
such as `WODAL_PROJECT_MISSING_WODAL_TARGET` or `INVALID_BYTECODE_VERSION`.
Human-readable messages are convenience text; tests and app logic should match
stable codes, not prose.

When adding a new error family, follow the existing repo convention:

- Export a `...Code` constant object.
- Export the corresponding union type.
- Include prose `message` fields only as secondary human context.
- Add direct tests for the new branch.

## API Surface Posture

Be conservative when adding public API. Permanent WODAL APIs, Mindcraft
builtins, tiles, ambient declarations, and target document fields are external
contracts. Add them only when the confirmed implementation slice needs them or
when the design has been explicitly reviewed.

Test-only APIs and fixtures may prove runtime behavior, but scope them clearly
to tests and do not register them as permanent platform surface.

When modeling CODAL APIs, ground the shape in the actual CODAL repositories or
official docs. Do not invent parity from memory or from unofficial docs without
checking the source shape.

## Communication Posture

Be direct and concrete. Good responses identify the actual current state, say
whether a direction is complete, partial, or missing, name the next small step,
explain ownership boundaries when they matter, and call out risks without
dramatizing them. Do not argue a plan is good merely because it avoids an
obviously bad alternative; let the technical reasoning carry the recommendation.

When handing work to a fresh session, include:

- The larger product goal.
- Explicit boundaries.
- Known state to verify.
- An instruction to read and summarize before editing.

## Fresh-Session Starter

For a fresh session, the desired posture is:

```text
First verify the current repo state. Do not implement immediately.

Read the relevant instructions and files, summarize the current shape, identify
one narrow next slice, and wait for confirmation before editing. Keep the slice
small enough to review, but complete enough to be useful. Preserve WODAL,
microbit-sim, the C++ VM (cpp/), shared Mindcraft package, and VM/runtime
boundaries.
```
