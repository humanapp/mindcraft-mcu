#!/usr/bin/env bash
# C++ host check suite: configure + build + run tests for every preset
# (debug, release, sanitize), then enforce formatting. Run from anywhere;
# operates on the cpp/ tree it lives in.
set -euo pipefail
cd "$(dirname "$0")"

for preset in debug release sanitize; do
  echo "==> preset: ${preset}"
  cmake --preset "${preset}"
  cmake --build --preset "${preset}"
  ctest --preset "${preset}"
done

clang_format=""
if command -v clang-format >/dev/null 2>&1; then
  clang_format="clang-format"
elif xcrun --find clang-format >/dev/null 2>&1; then
  clang_format="$(xcrun --find clang-format)"
else
  echo "error: clang-format not found (install LLVM or Xcode command line tools)" >&2
  exit 1
fi

echo "==> clang-format"
find core codal test tools \
  -path '*/vendor' -prune -o \
  \( -name '*.h' -o -name '*.cpp' \) -print0 |
  xargs -0 "${clang_format}" --dry-run -Werror

echo "==> dependency guardrails"
./check-deps.sh

echo "cpp check: all checks passed"
