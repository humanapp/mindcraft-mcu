#!/usr/bin/env python3
"""PreToolUse:(Edit|Write|MultiEdit|Bash): block work until the session is seeded.

Exits 2 (blocking) when required rule files recorded at session start have not
all been read in full. Fails open when no state exists for the session (the gate
was not armed -- e.g. SessionStart did not run), and treats an empty required
list (rule files missing) as a fatal seeding fault.
"""

import hashlib
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
        sys.exit(0)

    target = session_dir(str(payload.get("session_id", "unknown")))
    required_path = os.path.join(target, "required")
    if not os.path.isfile(required_path):
        sys.exit(0)  # gate not armed for this session: fail open

    with open(required_path) as handle:
        required = [line.strip() for line in handle if line.strip()]

    if not required:
        sys.stderr.write(
            "Seed gate: the authoritative rule files (AGENTS.md / "
            ".github/instructions/*.instructions.md) were not found at session "
            "start. This is a fatal seeding fault -- halt and report; do not "
            "continue.\n"
        )
        sys.exit(2)

    read_dir = os.path.join(target, "read")
    remaining = [
        path
        for path in required
        if not os.path.isfile(
            os.path.join(read_dir, hashlib.sha1(os.path.realpath(path).encode()).hexdigest())
        )
    ]

    if remaining:
        sys.stderr.write(
            "Seed gate: session not yet seeded with the authoritative posture. "
            "Read these files IN FULL (Read tool, no offset/limit) before any "
            "edit, write, or shell command:\n"
            + "\n".join("  - " + path for path in remaining)
            + "\nUse the Read tool on each (Read and Glob are not gated); do not "
            "shell out to read them.\n"
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
