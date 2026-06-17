#pragma once

#include <cstdint>

#include "core/runtime/program.h"
#include "hostkit/text-render.h"

namespace mindcraft {

/** Canonical program dump format version this emitter renders. */
inline constexpr uint32_t kCanonicalProgramDumpFormatVersion = 2;

/**
 * Renders a decoded program image as the canonical program dump: format
 * version 2, ASCII, LF line endings, trailing LF, byte-identical to the
 * rendering of
 * external/mindcraft-lang/packages/core/src/runtime/brain-program-dump.ts
 * for the same decoded program. Integer scalars render as minimal lowercase
 * hex of their unsigned 32-bit value; numeric values render as zero-padded
 * IEEE-754 f32 bit patterns; strings render double-quoted with non-printable
 * bytes escaped.
 *
 * Returns false without completing the dump when the image is not a
 * well-formed decode result: an instruction opcode without an
 * operand-schema row, an undeclared type-entry, value-kind, map-key, or
 * call-site-binding discriminant, or a cross-reference outside its pool.
 * Bytes already rendered stay written to `sink`.
 *
 * @param image - Decoded program image to render.
 * @param sink - Destination the dump text is written to.
 */
bool writeCanonicalProgramDump(const ProgramImage& image, TextSink& sink);

} // namespace mindcraft
