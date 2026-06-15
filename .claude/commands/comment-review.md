---
description: Independent semantic review of the change's new/changed source comments against the project comment guidelines.
argument-hint: "[optional paths to scope; default = all changed source files]"
allowed-tools: Agent, Bash(git diff:*), Read
---

Run an explicit, end-of-change comment-guideline review.

Dispatch a fresh general-purpose subagent (Agent tool) with the task below, so
the reviewer is independent of whoever wrote the comments. Then relay the
reviewer's verdict and, only if it reports failures, ask whether to apply the
fixes.

Subagent task:

----
You are an independent comment reviewer. Do NOT edit any files; only read and report.

1. Collect the change's source diff (working tree vs HEAD), changed lines only:
   `git diff -U0 HEAD -- '*.ts' '*.tsx' '*.cpp' '*.h' '*.hpp' '*.cc'`
   If the invoker scoped paths, restrict the pathspec to those: $ARGUMENTS
   (Changes inside the `external/mindcraft-lang` submodule do not appear in the
   parent diff; if the change touched it, also run the same diff from inside
   that directory.)

2. Read `.github/instructions/global.instructions.md`, section
   "Comments in Source Files". Treat it as the authority.

3. For every ADDED or CHANGED comment in the diff (added `+` lines inside `//`
   or `/* */`), judge it by MEANING, never by keyword matching -- a comment
   reworded to dodge a banned phrase still fails if its meaning is unchanged. A
   comment FAILS if it: (a) explains WHY -- design rationale, history, or a
   constraint that drove the current shape; (b) justifies the chosen design or
   contrasts it with an alternative; (c) merely restates what the code literally
   does; (d) carries a plan-only or work-item marker (a phase name, a locked
   decision number, a ticket id); or (e) describes what a DIFFERENT symbol does,
   what this symbol is NOT, or redirects the reader to another API. A comment
   PASSES if it states only what the symbol is (purpose, inputs, outputs,
   invariants, errors) or a genuine non-obvious intent or constraint.

4. Report each failing comment as `file:line` with the offending text, which
   rule (a-e) it breaks, and a corrected version that states what the symbol is.
   End with a single line: `VERDICT: PASS` (no violations) or `VERDICT: FAIL`.
----
