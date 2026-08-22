#pragma once

#include <cstddef>
#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/result.h"

namespace wendoo {

/**
 * The on-flash program region format: a reserved block of memory-mapped device
 * flash holding a header followed by a binary `.mcprogram` payload. The
 * board-neutral format lives here in the CODAL-common layer; a board supplies
 * the concrete region location (a linker symbol).
 *
 * Byte layout:
 *
 *   off  size  field
 *   0    4     magic           {@link kRegionMagicBytes} ("MCFR")
 *   4    1     formatVersion   {@link kOnFlashFormatVersion}
 *   5    ...   payload         binary `.mcprogram`, to the end of the region
 *
 * An erased region reads back as all `0xff`, so the magic is `0xffffffff` and
 * the boot path reports {@link RegionError::NoProgram}.
 *
 * The region magic and format version are mirrored by the host-side writer in
 * the wodal package's firmware-metadata module; keep them aligned and bump
 * {@link kOnFlashFormatVersion} on any layout change.
 */

/** Magic marking a written program region, in on-flash byte order: "MCFR". */
inline constexpr uint8_t kRegionMagicBytes[4] = {'M', 'C', 'F', 'R'};

/** On-flash region format version this boot path reads. Bump on any layout change. */
inline constexpr uint8_t kOnFlashFormatVersion = 1;

/** Header size in bytes; the payload begins this far into the region. */
inline constexpr size_t kRegionHeaderSize = 5;

/**
 * Stable diagnostic codes for the boot read-path's region validation. The
 * numeric values are local to this VM (they never travel on a wire); append
 * new members at the next free value. Rendered with the `R` fault-domain
 * prefix (e.g. `R1`).
 */
enum class RegionError : uint16_t {
  /** The region is erased / too small / holds no program (magic is all `0xff`). */
  NoProgram = 1,
  /** The magic is neither the erased pattern nor {@link kRegionMagicBytes}. */
  InvalidMagic = 2,
  /** The header format version is not {@link kOnFlashFormatVersion}. */
  UnsupportedFormatVersion = 3,
};

/**
 * Validate the on-flash region header in `region` and, on success, return a
 * borrowed view of the `.mcprogram` payload (the region bytes after the
 * header). The returned span points into `region`, so `region` must outlive any
 * use of the payload. The span may extend past the program into the region's
 * erased tail; the `.mcprogram` reader consumes only the program.
 *
 * @param region - Bytes of the reserved flash region.
 */
Result<ByteSpan, RegionError> readRegionProgram(ByteSpan region);

} // namespace wendoo
