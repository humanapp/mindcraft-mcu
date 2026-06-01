# Agent Instructions

These instructions apply to this repository.

Before working in any area of the codebase, list `.github/instructions/` and
read `global.instructions.md` plus any instruction files whose name matches the
area you are working in.

## Git Staging

The Git staging area is read-only for Codex, Copilot, Claude, or other agent.

The agent must never run `git add`, unstage files, or otherwise mutate the Git
index unless explicitly instructed by the user in that specific turn.

The agent must not emit staging directives.

## Command Approvals

- When requesting escalated command approval, include a narrow `prefix_rule`
  when safe and allowed so repeated commands can be approved persistently.
- Do not include a `prefix_rule` for destructive commands, heredocs, or overly
  broad command prefixes.

## Code Quality

- Never emit placeholder code. Do not use `TODO`, `FIXME`, `...`,
  `/* implementation */`, `throw new Error("Not implemented")`, or any other
  stub pattern unless the user has explicitly written a stub and is asking to
  fill it in.
- Never produce non-production statements such as `console.log("test")`,
  `console.log("here")`, hardcoded magic strings used only for debugging, or
  temporary workarounds presented as real code.
- Do not embed plan-only or work-item names in code, identifiers, string
  literals, test names, or fixtures. Markers like `phase 2b`, a milestone, or a
  ticket id are meaningful only while the work is in progress and become noise
  once the plan is complete. Name things for the behavior or domain concept they
  represent. Phase tracking belongs in the plan and its phase log; the code
  outlives them.
- Complete functions fully. If a complete implementation cannot be inferred
  from context, suggest the minimal correct skeleton rather than a placeholder
  body.
- Do not add comments that just restate what the code does. Only include
  comments that explain non-obvious intent, invariants, or constraints.
- Never use inline `import()` type expressions in `.ts` or `.tsx` files. Use a
  top-level `import type` statement instead.

## Code Examples and Documentation

Never create example source files in a project's `src` folder.

If creating ad-hoc feature documentation or example files, place them in a
`generated-docs/` folder at the project root to clearly indicate non-source,
auto-generated status. Include the creation date in the file name, for example
`example-feature-2026-05-10.ts` or `docs-feature-2026-05-10.md`.

## Comments in Source Files

For codebases where API documentation is appropriate, document exported types,
functions, classes, and non-trivial fields with JSDoc that explains what they
are and how to use them, so a reader can understand the code without external
context.

Write:

- JSDoc on exported symbols, including types, interfaces, classes, functions,
  and public methods, describing purpose, inputs, outputs, and invariants.
- Field-level JSDoc on non-obvious properties, including units, formats,
  allowed values, and nullability semantics.
- Brief inline comments where the logic itself is non-obvious and a reader
  would genuinely benefit from a hint about intent or an invariant.

Do not write:

- Rationale or history-lesson comments. Do not explain why a file is structured
  a certain way, why a refactor was done, or what constraints drove a past
  design decision.
- Comments that just restate what the code literally does.
- Stub-style placeholders like `// no implementation yet, but could add things
  like ...`.

Treat these phrasings as red flags in JSDoc on exported symbols when they
introduce design rationale:

- "... so that ..."
- "... rather than ..." when comparing the chosen design to an alternative
- "... instead of ..." when comparing the chosen design to an alternative
- "... not a ... -- ..."
- "... is exposed because ..."
- "... was chosen ..."

Scope each comment to its own symbol. Document what the symbol is, its inputs,
outputs, and errors -- nothing about what it is not, or what a different symbol
does. Do not redirect the reader to another API for a related-but-different
task, and do not contrast this symbol with an alternative. Phrasings like "to do
X instead, use `Y`", "use `Y` to ...", or "unlike `Y`, this ..." pull in scope
the reader did not ask about and invite tangential questions ("can this not do
X?", "what is `Y`?"). A cross-reference is justified only when a reader cannot
use this symbol correctly without it -- a required companion call or a
precondition established elsewhere -- and then state it as a plain instruction
("call `init()` first"), never as a contrast or a redirect to alternative
functionality.

- Avoid: `Compiles and links a brain. To run one instead, use createBrain().`
- Avoid: `Builds the image without constructing a runtime.`
- Prefer: `Compiles and links a brain and returns the linked program. Throws if
  it fails to compile or link.`

## ASCII-Only Text

Use only keyboard-typable ASCII characters in code comments, markdown
documentation, and string literals used for logging or display. Do not use
Unicode arrows, em dashes, bullet characters, box-drawing characters, or other
non-keyboard symbols.

Common substitutions:

- `->` instead of Unicode right arrows
- `<-` instead of Unicode left arrows
- `--` instead of em dash
- `-` instead of en dash, bullet characters, or middle dots
- `|` instead of box-drawing vertical lines
- `-` instead of box-drawing horizontal lines
- `[x]` instead of checkmark emoji
- `[ok]` instead of checkmark symbols

## Broad View Before Acting

Before making any change that touches more than one call site, method
signature, or data flow, read all involved files end-to-end and explicitly
identify every invariant the change must preserve: ordering, symmetry,
consistency across parallel code paths, and structural conventions.

If a proposed change would violate any identified invariant, reject it and find
an approach that does not.

The goal is not just to fix the immediate problem. Leave the code cleaner and
more coherent than it was found. If the task reveals a structural issue
adjacent to the immediate change, address it as part of the same change when
doing so is within scope.

## Repo-Specific Scope

- `external/mindcraft-lang` is the imported reference checkout. Read it for
  contracts, compiler behavior, and TypeScript VM semantics, but do not make
  product changes there unless the task explicitly targets the reference.
- `docs/specs/contracts/vm-contract.md` is the local contract anchor for VM
  bytecode compatibility once this repo owns a docs tree.
- Planned first-cut ownership:
  - `packages/wodal` owns the CODAL-inspired web device runtime, initially
    implementing the microbit profile.
  - `apps/microbit-sim` owns visual UI, project management, compiler
    integration, and browser product shell.
- WODAL and the MCU VM must respect the Mindcraft host calling convention and
  the single-entry VM rule: external callbacks enqueue only; the host loop
  drains, resolves handles, schedules, and executes.
