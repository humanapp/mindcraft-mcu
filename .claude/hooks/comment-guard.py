#!/usr/bin/env python3
"""Blocking PreToolUse guard: rejects edits whose new comment text contains a
banned comment-guideline phrasing.

Reads the PreToolUse hook JSON on stdin, extracts the text being written
(Write content, Edit/MultiEdit new_string), scans only the comment lines of
source files, and exits 2 (blocking the tool call) when a tight set of banned
phrasings appears. The matched phrasings are the recurring design-rationale /
plan-marker offenders called out in
.github/instructions/global.instructions.md.

Markdown is not scanned: the project's planning and contract docs legitimately
record rationale, phase tracking, and Locked Decisions, which the source-comment
rules forbid only in code.
"""

import json
import re
import sys

SCANNED_EXTENSIONS = (".ts", ".tsx", ".cpp", ".h", ".hpp", ".cc")

# Tight set of banned phrasings (case-insensitive). Each is a recurring
# design-justification or plan-only marker the comment guidelines forbid.
BANNED = [
    (re.compile(r"\bso that\b", re.IGNORECASE), "so that"),
    (re.compile(r"\brather than\b", re.IGNORECASE), "rather than"),
    (re.compile(r"\binstead of\b", re.IGNORECASE), "instead of"),
    (re.compile(r"\bwas chosen\b", re.IGNORECASE), "was chosen"),
    (re.compile(r"\bis exposed because\b", re.IGNORECASE), "is exposed because"),
    (re.compile(r"\bsized to\b", re.IGNORECASE), "sized to"),
    (re.compile(r"\bsized against\b", re.IGNORECASE), "sized against"),
    (re.compile(r"\bphase \d", re.IGNORECASE), "Phase <number>"),
    (re.compile(r"\blocked decision\b", re.IGNORECASE), "Locked Decision"),
]


def written_text(tool_name, tool_input):
    """The text this tool call would write, or empty when none applies."""
    if tool_name == "Write":
        return str(tool_input.get("content", ""))
    if tool_name == "Edit":
        return str(tool_input.get("new_string", ""))
    if tool_name == "MultiEdit":
        return "\n".join(str(e.get("new_string", "")) for e in tool_input.get("edits", []))
    return ""


def comment_text_per_line(text):
    """Yields the comment-only portion of each source line.

    Only the part of a line inside a `//` or `/* ... */` comment is yielded,
    keeping string literals and code out of the scan.
    """
    in_block = False
    for line in text.splitlines():
        rest = line
        buf = []
        while rest:
            if in_block:
                end = rest.find("*/")
                if end == -1:
                    buf.append(rest)
                    rest = ""
                else:
                    buf.append(rest[:end])
                    rest = rest[end + 2 :]
                    in_block = False
                continue
            line_pos = rest.find("//")
            block_pos = rest.find("/*")
            if line_pos != -1 and (block_pos == -1 or line_pos < block_pos):
                buf.append(rest[line_pos + 2 :])
                rest = ""
            elif block_pos != -1:
                rest = rest[block_pos + 2 :]
                in_block = True
            else:
                rest = ""
        yield " ".join(buf)


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # Not parseable: do not block.

    tool_input = payload.get("tool_input", {})
    file_path = str(tool_input.get("file_path", ""))
    if not file_path.endswith(SCANNED_EXTENSIONS):
        sys.exit(0)

    text = written_text(payload.get("tool_name", ""), tool_input)
    if not text:
        sys.exit(0)

    hits = []
    for comment in comment_text_per_line(text):
        for pattern, label in BANNED:
            if pattern.search(comment) and label not in hits:
                hits.append(label)

    if hits:
        sys.stderr.write(
            "Comment guard: the text written to "
            + file_path
            + " contains banned comment phrasing: "
            + ", ".join(repr(h) for h in hits)
            + ".\nThese are design-rationale / plan-only markers the comment rules forbid. "
            + "Re-audit the comment against .github/instructions/global.instructions.md "
            + '("Comments in Source Files"): state what the symbol is, delete the justification.\n'
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
