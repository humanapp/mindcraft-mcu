## Project rules

This file is a pointer, not the rule set. The authoritative rules live in
`AGENTS.md` and `.github/instructions/*.instructions.md`; read the full files,
not summaries of them.

A SessionStart hook (`.claude/settings.json`) lists these files at the start of
every Claude session, and a companion gate blocks Edit/Write/Bash until each has
been read in full. If the hooks are not active in this harness, read these
before your first edit, comment, or audit:

- `AGENTS.md`
- `.github/instructions/global.instructions.md`
- `.github/instructions/agent-posture.instructions.md` (working temperament and
  decision style; `applyTo: "**"`, so it always applies)
- every other `.github/instructions/*.instructions.md` whose `applyTo` glob
  matches the area you are touching (for `cpp/`, `packages/wodal/`,
  `apps/microbit-sim/`, that is `vm.instructions.md`)
