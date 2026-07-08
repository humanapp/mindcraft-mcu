# Agent Instructions

These instructions apply to this repository.

Before working in any area of the codebase, list `.github/instructions/` and
read `global.instructions.md` plus any instruction files whose name matches the
area you are working in.

For the working temperament and decision style to apply on ambiguous work
(small-step workflow, ownership boundaries, handoff posture), read
`.github/instructions/agent-posture.instructions.md`.

## Git Staging

The Git staging area is read-only for Codex, Copilot, Claude, or other agent.

The agent must never run `git add`, unstage files, or otherwise mutate the Git
index unless explicitly instructed by the user in that specific turn.

The agent must not emit staging directives.

## Never Kill Processes You Do Not Own

Never kill, signal, or otherwise terminate a process you did not start in the
current session. This is an absolute rule.

- A port being in use is NOT evidence the listener is stale, orphaned, or yours.
  A dev server matching this repo's app and working directory may well be the
  user's own running server. Same app, same cwd, same port does NOT mean "safe
  to kill."
- Do not run `kill`, `pkill`, `killall`, `kill -9`, or any equivalent against a
  process you cannot prove you launched this session.
- If a port you want is occupied, pick a different port, or stop and ask the
  user whether to free it -- do not free it yourself.
- This applies to dev servers, watchers, language servers, databases, and any
  other long-running process.

## Command Approvals

- When requesting escalated command approval, include a narrow `prefix_rule`
  when safe and allowed so repeated commands can be approved persistently.
- Do not include a `prefix_rule` for destructive commands, heredocs, or overly
  broad command prefixes.

## Package Manager

- This repo uses npm. Do not use pnpm or yarn, and do not add their lockfiles,
  a `packageManager` field, or `pnpm`/`yarn` invocations. The only root lockfile
  is `package-lock.json`.
- This is intentionally NOT an npm workspaces monorepo, and must not become one.
  There is no root `workspaces` field. Each package and app runs its own
  `npm install` into its own `node_modules`; cross-package links use `file:`
  dependencies and symlinks.
- Because there is no hoisting, every package must declare the dev tooling its
  own scripts invoke (for example `tsx`) in its own `devDependencies`, so the
  script resolves the binary from that package's `node_modules/.bin`. Do not
  rely on a root-level binary being on PATH, and do not work around a missing
  binary by editing PATH -- add the dependency to the package instead.
- Run scripts with npm from the relevant package directory, for example
  `npm test`, `npm run build`, `npm run typecheck`, `npm run generate:ambient`,
  `npm run check`.

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

## Minimalism (No Over-Build)

Build the minimum that satisfies the task's acceptance criteria; speculative
robustness is out of scope by default. Over-building -- adding machinery for
problems that cannot occur in the system as it exists today -- is a recurring
failure to actively guard against. The unifying tell: it defends against a state
that cannot occur today, or duplicates a guarantee an existing layer already
provides.

- Burden of proof is on inclusion, not omission. For every field, check, version,
  error code, abstraction, parameter, or guard, name the one concrete failure
  mode -- possible today -- that it prevents and that no existing layer already
  catches. If the only justification is a future scenario, a general good
  ("robustness", "safety", "completeness", "flexibility"), symmetry, or something
  already guaranteed elsewhere, leave it out.
- Scope = the test. Build only what an acceptance check exercises. If no test
  touches a field, branch, check, or abstraction, do not build it.
- Banned by default (each needs an explicit, today-failure-mode justification):
  redundant integrity (checksums or length fields duplicating an existing
  guarantee); compatibility/identity machinery (version numbers, content digests,
  build/firmware ids, handshakes) in a single-build, single-version world;
  future-proofing (reserved fields, "vN room", envelopes, abstraction for a
  consumer that does not exist yet); defensive validation of inputs that cannot be
  malformed; fixed- or cap-sized buffers and pools; error-code, state, or config
  inflation beyond what a path can reach.
- Subtraction before done. Before declaring a change complete, try to delete each
  piece you added; if no test breaks, remove it.
- When unsure, leave it out and let a real, failing test pull it in -- adding it
  later is cheap; carrying speculative machinery is not.

For the C++ VM work specifically, the binding prohibitions are Locked Decisions 7
(no pre-sized pools), 8 (no ABI compatibility machinery), and 9 (this principle,
generalized) in the plan under `generated-docs/`.

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
- **TWO first-class product consumers, both mandatory, co-equal.** The shared
  Mindcraft packages (`packages/core`, `packages/ts-compiler`,
  `packages/bridge-app`, `packages/app-host`, `packages/ui`) are consumed by two
  product apps that carry equal weight:
  - `apps/microbit-sim` (this repo), and
  - `external/mindcraft-lang/apps/sim` -- the game/sim app, which hosts live
    capability tiles (`[it]`/`see`/`bump`) on its OWN platform, unrelated to
    wodal/microbit.
  `apps/sim` is NOT secondary, NOT optional, and NOT "the standalone checkout":
  it lives at `external/mindcraft-lang/apps/sim` inside this tree. Any change to
  a shared package, or any cross-app / shared-model feature, MUST sweep and gate
  BOTH apps by their exact paths (typecheck + biome + test each) before it is
  done -- a change verified only against microbit-sim is INCOMPLETE. When
  designing a shared feature, design for both consumers from the start: any
  default, assumption, or example tied to microbit-sim's platform
  (wodal/microbit-v2) must state how it also serves apps/sim's distinct
  platform. (Gating and design for `apps/sim` is required even though it lives
  in the reference checkout; this is the one standing reason to run its suites.)
- WODAL and the MCU VM must respect the Mindcraft host calling convention and
  the single-entry VM rule: external callbacks enqueue only; the host loop
  drains, resolves handles, schedules, and executes.
