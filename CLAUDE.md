## STOP - read the authoritative rules before any work

A SessionStart hook (`.claude/settings.json`) auto-injects this project's complete
rule set into context at the start of every Claude session: `AGENTS.md` plus every
`.github/instructions/*.instructions.md`. Read and follow them.

If for any reason that injected block is not present in this session (hook disabled,
or a different agent/harness), then before your first edit, comment, or audit you
MUST open and read these files IN FULL:

- `AGENTS.md`
- `.github/instructions/global.instructions.md`
- every `.github/instructions/*.instructions.md` whose `applyTo` glob matches the
  area you are touching (for `cpp/`, `packages/wodal/`, `apps/microbit-sim/`, that is
  `vm.instructions.md`)

This file is NOT the rule set; it is a pointer to it. Do not treat this file, the
auto-injected `CLAUDE.md` snippets, or any summary as complete. Do not satisfy the
read by grepping for a keyword or skimming one section - read each file end to end.
The rules you are accountable for (comment guidelines, the plan-only-names ban, the
authoring-only scope of the ASCII rule, the zero-noise check policy, minimalism) live
only in those files, not here.
