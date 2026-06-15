#!/usr/bin/env python3
"""PostToolUse:Read: mark a required rule file as read once it is read in full.

Only a full read (Read tool with no offset and no limit) counts toward seeding,
matching the "read in full" requirement. Non-required files are ignored.
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

    tool_input = payload.get("tool_input", {})
    file_path = tool_input.get("file_path")
    if not file_path:
        sys.exit(0)
    if tool_input.get("offset") is not None or tool_input.get("limit") is not None:
        sys.exit(0)  # partial read does not satisfy "read in full"

    target = session_dir(str(payload.get("session_id", "unknown")))
    required_path = os.path.join(target, "required")
    if not os.path.isfile(required_path):
        sys.exit(0)

    abspath = os.path.realpath(file_path)
    with open(required_path) as handle:
        required = [os.path.realpath(line.strip()) for line in handle if line.strip()]

    if abspath in required:
        read_dir = os.path.join(target, "read")
        os.makedirs(read_dir, exist_ok=True)
        marker = hashlib.sha1(abspath.encode()).hexdigest()
        open(os.path.join(read_dir, marker), "w").close()

    sys.exit(0)


if __name__ == "__main__":
    main()
