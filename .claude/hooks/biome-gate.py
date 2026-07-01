#!/usr/bin/env python3
"""Blocking Stop guard: refuses to end a turn while a changed TypeScript/JS
file fails Biome's checks.

Reads the Stop/SubagentStop hook JSON on stdin, finds the changed and untracked
source files in the working tree (git), runs the package-local Biome binary on
them, and exits 2 (blocking the stop) with the diagnostics when any file is not
clean. Honors `stop_hook_active` so a non-converging check cannot wedge the
session.

The check is scoped to files the current agent edited in THIS turn, identified
from the transcript named in the payload (`transcript_path`): a stop is
responsible only for the changes this turn made, never a prior turn's committed
change and never a different agent editing the same shared file concurrently.
When the turn's edits cannot be determined, it checks nothing (fail open).

Biome zero-noise on TypeScript/JS changes is a standing order, and the package
test scripts do not run Biome; this gate enforces it at the turn boundary, the
TypeScript counterpart to the C++ clang-format gate in cpp/check.sh.
"""

import json
import os
import subprocess
import sys

# Short-lived hook: skip writing a __pycache__ for the shared-helper import below.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _hook_turn_scope import current_turn_edited_paths

CHECKED_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc")


def project_dir():
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def repo_dirs(root):
    """The root repo plus every recursive submodule working directory.

    A submodule's working-tree changes do not appear in the superproject's
    `git diff`, so each submodule repo is queried on its own.
    """
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


def changed_files(root):
    """Absolute paths of changed and untracked files across the root repo and
    every submodule."""
    paths = set()
    for repo in repo_dirs(root):
        for args in (
            ["git", "diff", "--name-only", "HEAD"],
            ["git", "ls-files", "--others", "--exclude-standard"],
        ):
            try:
                out = subprocess.run(
                    args, cwd=repo, capture_output=True, text=True, check=False
                ).stdout
            except OSError:
                continue
            for line in out.splitlines():
                rel = line.strip()
                if rel:
                    paths.add(os.path.join(repo, rel))
    return paths


def is_candidate(path, root):
    """True for a Biome-checkable source file outside any node_modules/."""
    if not path.endswith(CHECKED_EXTENSIONS):
        return False
    if "node_modules" in os.path.relpath(path, root).split(os.sep):
        return False
    return os.path.isfile(path)


def find_biome(path):
    """Nearest node_modules/.bin/biome at or above `path`'s directory, or None."""
    directory = os.path.dirname(os.path.abspath(path))
    while True:
        candidate = os.path.join(directory, "node_modules", ".bin", "biome")
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
        parent = os.path.dirname(directory)
        if parent == directory:
            return None
        directory = parent


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}

    # A check that already blocked this turn must not wedge the session.
    if payload.get("stop_hook_active"):
        sys.exit(0)

    root = project_dir()
    owned = current_turn_edited_paths(payload)
    groups = {}  # biome binary path -> files it should check
    for path in changed_files(root):
        if os.path.realpath(path) not in owned:
            continue  # Not edited this turn (a prior turn or another agent).
        if not is_candidate(path, root):
            continue
        biome = find_biome(path)
        if biome is None:
            continue  # No package-local Biome: cannot enforce, do not block.
        groups.setdefault(biome, []).append(path)

    if not groups:
        sys.exit(0)

    failures = []
    for biome, files in groups.items():
        package_dir = os.path.dirname(os.path.dirname(os.path.dirname(biome)))
        # --no-errors-on-unmatched: a changed file that Biome itself ignores
        # (e.g. a generated .d.ts under an ignored path) must not fail the gate;
        # real diagnostics on checked files still set a nonzero exit.
        result = subprocess.run(
            [biome, "check", "--no-errors-on-unmatched", *sorted(files)],
            cwd=package_dir,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            failures.append((result.stdout or "") + (result.stderr or ""))

    if failures:
        sys.stderr.write(
            "Biome gate: changed TypeScript/JS files are not clean. Zero-noise "
            "Biome is a standing order and the package test scripts do not run "
            "Biome.\nFix before ending the turn: run `npx biome check --write "
            "./src` in the affected package, then re-verify with `npx biome "
            "check ./src`.\n\n" + "\n".join(failures)
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
