#!/usr/bin/env python3
"""SessionStart: arm the seed gate and print a short, non-truncating directive.

The full ruleset is too large to inject inline (it gets truncated), so instead
of dumping it this records the files that must be read in full this session and
prints an instruction to read them. The seed-gate-check hook blocks Edit/Write/
MultiEdit/Bash until every recorded file has been read (seed-gate-mark).
"""

import glob
import json
import os
import sys


def state_root():
    return os.path.join(os.environ.get("TMPDIR", "/tmp"), "claude-seed-gate")


def session_dir(session_id):
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_") or "unknown"
    return os.path.join(state_root(), safe)


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}

    session_id = str(payload.get("session_id", "unknown"))
    project = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())

    required = [os.path.join(project, "AGENTS.md")]
    required += sorted(
        glob.glob(os.path.join(project, ".github", "instructions", "*.instructions.md"))
    )
    required = [p for p in required if os.path.isfile(p)]

    target = session_dir(session_id)
    os.makedirs(os.path.join(target, "read"), exist_ok=True)
    with open(os.path.join(target, "required"), "w") as handle:
        handle.write("\n".join(required))

    print("==== AUTHORITATIVE PROJECT RULES (not injected inline) ====")
    print("The complete ruleset is too large to inject without truncation, so it")
    print("is NOT in your context. Before any work (edit, comment, audit, analysis)")
    print("you MUST read these files IN FULL with the Read tool (no offset/limit):")
    if required:
        for path in required:
            print("  - " + path)
    else:
        print("  (NONE FOUND. AGENTS.md / .github/instructions are missing:")
        print("   fatal seeding fault -- halt and report, do not continue.)")
    print("Edit/Write/MultiEdit/Bash are BLOCKED until you have read them all this")
    print("session. Incomplete seed is a fault: recover by reading, or halt if")
    print("the files cannot be read.")


if __name__ == "__main__":
    main()
