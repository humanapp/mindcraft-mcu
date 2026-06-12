#!/usr/bin/env bash
# Dependency-edge guardrails for the C++ tree:
#   - core/ depends on nothing in this tree and only a freestanding-leaning
#     slice of the standard library.
#   - codal/ depends on core/ and CODAL only, and must contain no
#     microbit-v2 (board-specific) references.
# targets/<board>/ may depend on both, so it is not constrained here.
set -euo pipefail
cd "$(dirname "$0")"

fail=0

violation() {
  echo "guardrail violation: $1"
  echo "$2" | sed 's/^/  /'
  fail=1
}

core_files=$(find core \( -name '*.h' -o -name '*.cpp' \))
codal_files=$(find codal \( -name '*.h' -o -name '*.cpp' \))

# core/: quoted includes must stay inside core/.
out=$(grep -Hn '#include "' ${core_files} | grep -v '#include "core/' || true)
[ -n "${out}" ] && violation "core/ may only quote-include core/ headers" "${out}"

# core/: angle includes limited to the freestanding-leaning allowlist.
out=$(grep -Hn '#include <' ${core_files} |
  grep -vE '#include <(cstdint|cstddef|cstring|type_traits|array)>' || true)
[ -n "${out}" ] && violation "core/ angle-include outside the freestanding allowlist" "${out}"

# codal/: quoted includes must stay inside core/ or codal/.
out=$(grep -Hn '#include "' ${codal_files} |
  grep -vE '#include "(core|codal)/' || true)
[ -n "${out}" ] && violation "codal/ may only quote-include core/ or codal/ headers" "${out}"

# codal/: board-agnostic - no microbit-v2 symbols, headers, or paths.
out=$(grep -HnE 'MicroBit|MICROBIT|[nN][rR][fF]52|targets/' ${codal_files} || true)
[ -n "${out}" ] && violation "codal/ must not reference microbit-v2 specifics" "${out}"

if [ "${fail}" -ne 0 ]; then
  exit 1
fi
echo "dependency guardrails: OK"
