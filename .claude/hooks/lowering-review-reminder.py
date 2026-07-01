#!/usr/bin/env python3
"""PostToolUse: once-per-session reminder for edits to the bytecode-lowering codepaths.

On the FIRST Edit/Write/MultiEdit this session that touches a lowering source
file, emit the failure-codepath review checklist as additionalContext; then stay
silent for the rest of the session. Firing once (session-marker keyed by
session_id, same pattern as seed-gate) avoids the habituation an identical
per-edit reminder causes -- a signal that repeats carries no marginal
information and trains the reader to ignore it.

The Stop-time `lowering-test-gate` is the enforcement (it blocks a turn that
changes resolution code without a reaching test); this hook is only the
in-context orienting cue when lowering work begins. Always exits 0 -- never
blocks an edit. Prints nothing for any non-lowering file.
"""

import json
import os
import sys

# Suffix-matched against the edited file's path (absolute paths end with these).
LOWERING_FILES = (
    "packages/ts-compiler/src/compiler/lowering.ts",
    "packages/ts-compiler/src/compiler/project.ts",
    "packages/ts-compiler/src/compiler/descriptor.ts",
    "packages/ts-compiler/src/compiler/diag-codes.ts",
    "packages/core/src/brain/compiler/rule-compiler.ts",
    "packages/core/src/brain/compiler/emitter.ts",
)

REMINDER = (
    "Lowering codepath edited. Run a FAILURE-CODEPATH REVIEW before reporting done: "
    "walk every new/changed branch and resolution step; each failure mode (unresolvable "
    "type/name, missing binding, type mismatch, unexpected node kind, a resolve/lookup or "
    "Map.get returning undefined) must push its own precise diagnostic (right code, message "
    "naming the real cause, right node anchor) OR be provably unreachable. Do NOT silently "
    "skip and do NOT rely on an unrelated downstream diagnostic. Add a reaching test per "
    "new/changed branch (a RUNS golden or a precise-diagnostic assertion) -- the Stop-time "
    "lowering-test-gate enforces this. See memory: lowering-no-silent-failures."
)


def marker_path(session_id):
    """Per-session flag file; presence means the reminder already fired this session."""
    root = os.path.join(os.environ.get("TMPDIR", "/tmp"), "claude-lowering-reminder")
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_") or "unknown"
    return os.path.join(root, safe)


def main() -> None:
    try:
        event = json.load(sys.stdin)
    except (ValueError, TypeError):
        return
    if not isinstance(event, dict):
        return
    tool_input = event.get("tool_input")
    file_path = tool_input.get("file_path", "") if isinstance(tool_input, dict) else ""
    normalized = str(file_path).replace("\\", "/")
    if not any(normalized.endswith(rel) for rel in LOWERING_FILES):
        return

    marker = marker_path(str(event.get("session_id", "unknown")))
    if os.path.exists(marker):
        return  # already reminded this session
    try:
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        open(marker, "w").close()
    except OSError:
        pass  # cannot record the flag; still emit this once

    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": REMINDER,
                }
            }
        )
    )


if __name__ == "__main__":
    main()
