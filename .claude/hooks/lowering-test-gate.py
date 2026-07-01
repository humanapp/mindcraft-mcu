#!/usr/bin/env python3
"""Blocking Stop guard: a turn that changes the bytecode-lowering resolution
files must ship tests for what it changed.

Two checks, both scoped to files the current agent edited in THIS turn (the
transcript entries after the last user prompt), so a stop is responsible only for
the changes this turn made -- never a prior turn's already-committed change, and
never a different agent editing the same shared file concurrently:

  #1 Resolution change without a test. If this turn gave lowering.ts or
     project.ts non-comment code changes but this turn changed no *.spec.ts in
     the ts-compiler package, block. (A per-callsite resolution branch that
     faults only at runtime is invisible to a happy-path suite; a change to it
     must arrive with a test that runs or a diagnostic that asserts.)

  #2 Diagnostic emitted with no test. If a newly-added source line under the
     compiler dir emits a `LoweringDiagCode.<X>` that no *.spec.ts in the package
     references, block -- a diagnostic branch with no assertion.

Honors `stop_hook_active`: the gate fires at most once per stop attempt, so it
cannot wedge the session. A pure refactor covered by the existing suite is let
through on the immediate re-stop; the one block still surfaces the requirement.

This enforces the mechanical proxies for `lowering-no-silent-failures`: it does
not prove every branch is adversarially exercised (only a scenario matrix or
mutation testing does that), but it converts "I reasoned about it" into "the diff
shows a test / the diagnostic is asserted."
"""

import json
import os
import re
import subprocess
import sys

# Short-lived hook: skip writing a __pycache__ for the shared-helper import below.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _hook_turn_scope import current_turn_edited_paths

# Suffix-matched against absolute paths.
RESOLUTION_SUFFIXES = (
    "packages/ts-compiler/src/compiler/lowering.ts",
    "packages/ts-compiler/src/compiler/project.ts",
)
COMPILER_DIR_MARKER = "packages/ts-compiler/src/compiler/"
PACKAGE_DIFF_PATHSPEC = "packages/ts-compiler/src"
DIAG_RE = re.compile(r"LoweringDiagCode\.([A-Za-z_]\w*)")


def project_dir():
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def repo_dirs(root):
    """The root repo plus every recursive submodule working directory. A
    submodule's working-tree changes do not appear in the superproject's
    `git diff`, so each submodule repo is queried on its own."""
    dirs = [root]
    try:
        out = subprocess.run(
            ["git", "submodule", "foreach", "--recursive", "--quiet", 'echo "$displaypath"'],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except OSError:
        return dirs
    for line in out.splitlines():
        rel = line.strip()
        if rel:
            dirs.append(os.path.join(root, rel))
    return dirs


def changed_names(repo):
    """Absolute paths of tracked files changed vs HEAD under the ts-compiler
    package in `repo`."""
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", "HEAD", "--", PACKAGE_DIFF_PATHSPEC],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except OSError:
        return set()
    return {os.path.join(repo, line.strip()) for line in out.splitlines() if line.strip()}


def added_lines_by_file(repo):
    """{abs_path: [added source lines]} for tracked changes vs HEAD under the
    ts-compiler package, from `git diff HEAD -U0` (added lines only)."""
    try:
        out = subprocess.run(
            ["git", "diff", "HEAD", "--unified=0", "--", PACKAGE_DIFF_PATHSPEC],
            cwd=repo,
            capture_output=True,
            text=True,
            check=False,
        ).stdout
    except OSError:
        return {}
    result = {}
    current = None
    for line in out.splitlines():
        if line.startswith("+++ "):
            path = line[4:].strip()
            if path == "/dev/null":
                current = None
                continue
            if path.startswith("b/"):
                path = path[2:]
            current = os.path.join(repo, path)
            result.setdefault(current, [])
        elif line.startswith("diff --git") or line.startswith("--- "):
            if line.startswith("diff --git"):
                current = None
        elif line.startswith("+") and not line.startswith("+++") and current is not None:
            result[current].append(line[1:])
    return result


def is_noncomment_code(line):
    """True for an added line that is not blank and not a `//` / JSDoc / block
    comment line (heuristic; JSDoc uses `*`-prefixed continuations)."""
    stripped = line.strip()
    if not stripped:
        return False
    return not (stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"))


def diag_covered(package_src, ident):
    """True when some *.spec.ts under `package_src` references
    `LoweringDiagCode.<ident>`."""
    needle = f"LoweringDiagCode.{ident}"
    for root_dir, _dirs, files in os.walk(package_src):
        if "node_modules" in root_dir.split(os.sep):
            continue
        for name in files:
            if not name.endswith(".spec.ts"):
                continue
            try:
                with open(os.path.join(root_dir, name), encoding="utf-8") as handle:
                    if needle in handle.read():
                        return True
            except OSError:
                continue
    return False


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}

    # A gate that already blocked this stop attempt must not wedge the session.
    if payload.get("stop_hook_active"):
        sys.exit(0)

    root = project_dir()
    owned = current_turn_edited_paths(payload)

    def is_owned(abs_path):
        return os.path.realpath(abs_path) in owned

    # The "a test cleared it" signal is scoped to THIS turn too: a *.spec.ts under
    # the ts-compiler package that this turn edited. Scoping both sides keeps a
    # sibling agent's unrelated spec change from masking a missing test here.
    spec_edited_this_turn = any(
        path.endswith(".spec.ts") and PACKAGE_DIFF_PATHSPEC in path.replace("\\", "/")
        for path in owned
    )

    reasons = []
    for repo in repo_dirs(root):
        names = changed_names(repo)
        if not names:
            continue
        added = added_lines_by_file(repo)
        package_src = os.path.join(repo, "packages", "ts-compiler", "src")

        # #1: a resolution file THIS TURN changed with non-comment code, while
        # THIS TURN changed no *.spec.ts in the package.
        resolution_touched = any(
            abs_path.endswith(RESOLUTION_SUFFIXES)
            and is_owned(abs_path)
            and any(is_noncomment_code(line) for line in lines)
            for abs_path, lines in added.items()
        )
        if resolution_touched and not spec_edited_this_turn:
            reasons.append(
                "  #1 lowering.ts / project.ts changed (non-comment code) this turn, but this "
                "turn changed no *.spec.ts in packages/ts-compiler. A resolution-branch change "
                "can fault only at runtime; it must ship a test that RUNS (build a brain, tick it, "
                "assert the value) or a diagnostic assertion. If this is a pure refactor already "
                "covered by the committed suite, this gate is one-shot -- re-stop to proceed."
            )

        # #2: a newly-emitted diagnostic under the compiler dir with no spec reference.
        emitted = {}
        for abs_path, lines in added.items():
            normalized = abs_path.replace("\\", "/")
            if COMPILER_DIR_MARKER not in normalized or normalized.endswith(".spec.ts"):
                continue
            if not is_owned(abs_path):
                continue
            for line in lines:
                for match in DIAG_RE.finditer(line):
                    emitted.setdefault(match.group(1), True)
        uncovered = sorted(ident for ident in emitted if not diag_covered(package_src, ident))
        if uncovered:
            reasons.append(
                "  #2 new source emits diagnostic(s) that no *.spec.ts asserts: "
                + ", ".join(f"LoweringDiagCode.{ident}" for ident in uncovered)
                + ". Add a test that reaches the branch and asserts the code."
            )

    if reasons:
        sys.stderr.write(
            "Lowering test gate: this turn changed bytecode-lowering resolution code without "
            "the tests that prove it. lowering-no-silent-failures requires a reaching test per "
            "new/changed branch (a RUNS golden or a precise-diagnostic assertion), not an "
            "in-head review.\n\n" + "\n".join(reasons) + "\n"
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
