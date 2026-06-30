#!/usr/bin/env python3
"""PostToolUse reminder for edits to the bytecode-lowering codepaths.

When Edit/Write/MultiEdit touches one of the lowering source files, emit a
failure-codepath review checklist as additionalContext so the model runs the
review before reporting done. Prints nothing for any other file. Always exits 0
so it never blocks an edit.
"""

import json
import sys

# Suffix-matched against the edited file's path (absolute paths end with these).
LOWERING_FILES = (
    "packages/ts-compiler/src/compiler/lowering.ts",
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
    "skip and do NOT rely on an unrelated downstream diagnostic. Add a test per new "
    "diagnostic. See memory: lowering-no-silent-failures."
)


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
