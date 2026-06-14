/**
 * The build->patcher firmware metadata: where a compiled brain is patched into
 * the firmware's reserved on-flash region. The C++ firmware build emits one
 * JSON file (conforming to {@link FirmwareMetadata}) alongside the prebuilt
 * firmware hex; the host patcher reads it to write the on-flash header (see the
 * format in cpp/codal/on-flash-region.h) plus the program at `regionOffset`.
 *
 * The region magic and format version mirror the C++ header; keep them aligned
 * and bump {@link ON_FLASH_FORMAT_VERSION} on any layout change.
 */

/** Version of this metadata schema. Bump on any breaking field change. */
export const FIRMWARE_METADATA_SCHEMA_VERSION = 1;

/** On-flash region format version (mirror of `kOnFlashFormatVersion`). */
export const ON_FLASH_FORMAT_VERSION = 1;

/** On-flash header size in bytes; the payload begins this far into the region
 * (mirror of `kRegionHeaderSize`). */
export const ON_FLASH_HEADER_SIZE = 5;

/** On-flash region magic, lowercase hex of the four bytes "MCFR" in on-flash
 * byte order (mirror of `kRegionMagicBytes`). */
export const ON_FLASH_REGION_MAGIC_HEX = "4d434652";

/** The build->patcher firmware metadata. */
export interface FirmwareMetadata {
  /** Schema version; equals {@link FIRMWARE_METADATA_SCHEMA_VERSION}. */
  schemaVersion: number;
  /** Absolute flash byte address of the reserved region's first byte. */
  regionOffset: number;
  /** Byte length of the reserved region (header plus payload capacity). */
  regionSize: number;
  /** Region magic the patcher writes; equals {@link ON_FLASH_REGION_MAGIC_HEX}. */
  regionMagic: string;
  /** On-flash format version; equals {@link ON_FLASH_FORMAT_VERSION}. */
  onFlashFormatVersion: number;
}
