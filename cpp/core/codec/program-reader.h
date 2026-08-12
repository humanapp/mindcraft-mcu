#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/load-error.h"
#include "core/runtime/program.h"
#include "core/runtime/region-arena.h"
#include "core/runtime/result.h"

namespace mindcraft {

/** Binary `.mcprogram` envelope/format version this reader decodes. */
inline constexpr uint8_t kBinaryProgramFormatVersion = 4;

/** Options controlling {@link readProgramImage}. */
struct ProgramReaderOptions {
  /**
   * Number of type atoms owned by the active target, dense from
   * {@link TARGET_TYPE_ATOM_BASE}. A TYPS atom entry whose atomId falls
   * outside the core range, this target range, and the shared range fails with
   * `LoadError::UnknownTypeAtom`.
   */
  uint32_t targetTypeAtomCount;
  /**
   * Number of shared type atoms, dense from {@link SHARED_TYPE_ATOM_BASE}.
   * Defaults to 0 (a reader that expects no shared atoms); the active firmware
   * supplies the count of shared types its installed shared module registers.
   */
  uint32_t sharedTypeAtomCount = 0;
};

/**
 * Decodes a binary `.mcprogram` buffer into a {@link ProgramImage} whose
 * pools are allocated from `arena`. The wire layout is the format-version-3
 * encoding of
 * external/mindcraft-lang/packages/core/src/runtime/brain-program-binary-codec.ts:
 * a 4-byte magic, a format version byte, the profileId var-uint, a presence
 * bitmask, then the positional sections `CSTR`, `TYPS`, `CNUM`, `CVAL`,
 * `FUNC`, `VARS`, the present optional sections (`ACTS`, `RULF`, `RANC`,
 * `SYST`), and `PAGE`. Numbers decode at the f32 device precision; an f64
 * numeric entry fails with `LoadError::F64OnF32Target`.
 *
 * String bytes are borrowed from `wire`, so `wire` and the arena's backing
 * storage must both outlive the returned image.
 *
 * Fails with the matching {@link LoadError} on a malformed buffer (bad
 * magic, format version other than {@link kBinaryProgramFormatVersion},
 * truncation, var-int overflow, or a malformed section body) and with
 * `LoadError::ArenaExhausted` when `arena` cannot hold the decoded pools.
 *
 * @param wire - Encoded binary `.mcprogram` payload.
 * @param arena - Arena the decoded pools are allocated from.
 * @param options - Target type-atom range used to validate TYPS atom entries.
 */
Result<ProgramImage, LoadError> readProgramImage(ByteSpan wire, RegionArena& arena,
                                                 const ProgramReaderOptions& options);

} // namespace mindcraft
