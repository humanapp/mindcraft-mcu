# Agent Instructions

These instructions apply to this repository.

Before working in any area of the codebase, list `.github/instructions/` and
read `global.instructions.md` plus any instruction files whose name matches the
area you are working in. `global.instructions.md` is the canonical home of the
comment guidelines, the plan-only-names ban, the ASCII-only rule, the zero-noise
check policy, and the broad-view rule; those rules are not repeated here.

For the working temperament and decision style to apply on ambiguous work
(small-step workflow, ownership boundaries, handoff posture), read
`.github/instructions/agent-posture.instructions.md`.

## Git Is Read-Only

Git is a read-only tool for Codex, Copilot, Claude, and any other agent,
including subagents spawned for a task. Use it freely to inspect and to query
history: `status`, `log`, `diff`, `show`, `blame`, `reflog`, `rev-parse`,
`for-each-ref`, `branch --list`, and the like. `git rm` and `git mv` are also
allowed, as ordinary file operations while editing the repo.

Everything that changes repository state -- the working tree, the index, the
stash, or any commit, branch, tag, or ref -- is the user's to run. Do it only
when the user asks for that specific write in that turn.

Two commands read as harmless but are writes: `git checkout -- <file>` and
`git restore <file>` discard uncommitted work. Treat them as writes.

To undo or fix a file, edit or regenerate it directly, and leave changes you did
not make as they stand.

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

- This repo uses npm exclusively; the only root lockfile is `package-lock.json`.
  Keep pnpm and yarn out entirely -- no alternate lockfiles, no `packageManager`
  field, no `pnpm`/`yarn` invocations.
- This is intentionally NOT an npm workspaces monorepo, and must not become one.
  The platform submodule is consumed by two independent repository roots, and a
  workspace root cannot span them: two roots would each claim the same packages
  while edits are mirrored into both working trees, which is a failure class the
  current layout does not have. There is no root `workspaces` field. Each
  package and app runs its own `npm install` into its own `node_modules`;
  cross-package links use `file:` dependencies and symlinks.
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
- Complete functions fully. If a complete implementation cannot be inferred
  from context, suggest the minimal correct skeleton rather than a placeholder
  body.
- Write type-only imports as a top-level `import type` statement in `.ts` and
  `.tsx` files; do not use inline `import()` type expressions.

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
- The shared Mindcraft packages (`packages/core`, `packages/ts-compiler`,
  `packages/bridge-app`, `packages/app-host`, `packages/ui`) have two
  first-class, co-equal product consumers: `apps/microbit-sim` (this repo) and
  `external/mindcraft-lang/apps/ecosim`, the game/sim app, which hosts live
  capability tiles (`[it]`/`see`/`bump`) on its own platform, unrelated to
  wodal/microbit. A change to a shared package or shared model is not done
  until both apps are swept and gated (typecheck + biome + test each); this is
  the one standing reason to run suites in the reference checkout. Design
  shared features for both consumers from the start: a default, assumption, or
  example tied to microbit-sim's platform (wodal/microbit-v2) must state how it
  also serves apps/ecosim's distinct platform.
- WODAL and the MCU VM must respect the Mindcraft host calling convention and
  the single-entry VM rule: external callbacks enqueue only; the host loop
  drains, resolves handles, schedules, and executes.
