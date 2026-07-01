#!/usr/bin/env python3
"""Shared helper for the Stop-hook gates: which files did the current agent edit
in THIS turn.

Both the Biome gate and the lowering test gate must attribute a working-tree
change to the stop that made it -- never to a prior turn's already-committed
change, and never to a different agent editing the same shared file at the same
time. A concurrent agent's edits live in its own transcript, so turn scope (edits
after the last user prompt in THIS transcript) is what isolates them. Keeping the
parser in one place stops the two gates from drifting apart.
"""

import json
import os


def current_turn_edited_paths(payload):
    """Real paths of files the current agent edited in THIS turn -- the edits that
    appear in the transcript (named in `payload["transcript_path"]`) after the last
    real user prompt.

    Returns an empty set when the transcript is missing, unreadable, or has no
    identifiable user prompt: with nothing attributable to this turn, a caller
    stays silent (fail open) -- a gate that cannot scope a change must not block on
    a guess."""
    transcript = payload.get("transcript_path")
    if not isinstance(transcript, str) or not os.path.isfile(transcript):
        return set()
    edit_tools = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
    entries = []
    try:
        with open(transcript, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except (json.JSONDecodeError, ValueError):
                    continue
    except OSError:
        return set()

    last_prompt = -1
    for index, entry in enumerate(entries):
        if _is_user_prompt(entry):
            last_prompt = index
    if last_prompt < 0:
        return set()

    edited = set()
    for entry in entries[last_prompt + 1 :]:
        if entry.get("type") != "assistant":
            continue
        message = entry.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_use":
                continue
            if item.get("name") not in edit_tools:
                continue
            tool_input = item.get("input")
            if not isinstance(tool_input, dict):
                continue
            file_path = tool_input.get("file_path") or tool_input.get("notebook_path")
            if isinstance(file_path, str) and file_path:
                edited.add(os.path.realpath(file_path))
    return edited


def _is_user_prompt(entry):
    """The turn boundary is the last real user prompt: a user-role entry whose
    content is plain text (a string, or a list with no tool_result item). A message
    carrying a tool_result is a tool-response turn, not a prompt."""
    if entry.get("type") != "user":
        return False
    message = entry.get("message")
    if not isinstance(message, dict) or message.get("role") != "user":
        return False
    content = message.get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        types = [item.get("type") for item in content if isinstance(item, dict)]
        return "tool_result" not in types
    return False
