/**
 * The firmware hex patcher: writes a compiled binary `.mcprogram` into a
 * prebuilt firmware's reserved on-flash region and returns a corrected Intel
 * HEX. A pure byte transform with no Node or DOM dependency.
 *
 * It writes the 5-byte on-flash header (the "MCFR" magic and format version,
 * from the {@link ON_FLASH_REGION_MAGIC_HEX}/{@link ON_FLASH_FORMAT_VERSION}
 * constants) followed by the program bytes, at the `regionOffset` carried by the
 * build's {@link FirmwareMetadata}.
 */

import {
  type FirmwareMetadata,
  ON_FLASH_FORMAT_VERSION,
  ON_FLASH_HEADER_SIZE,
  ON_FLASH_REGION_MAGIC_HEX,
} from "./firmware-metadata";
import { encodeDataRecords, spliceRecordsBeforeEof } from "./intel-hex";

/** Error code reported when a program does not fit the firmware's region. */
export const FIRMWARE_PATCH_PROGRAM_TOO_LARGE = "program-too-large";

/** Reported when the header plus program exceed the region's byte capacity. */
export interface FirmwarePatchProgramTooLargeError {
  code: typeof FIRMWARE_PATCH_PROGRAM_TOO_LARGE;
  /** Bytes the patch needs: header size plus the program length. */
  requiredBytes: number;
  /** Byte capacity of the reserved region, from the metadata. */
  regionSize: number;
}

/** Result of {@link patchFirmwareHex}: the patched hex, or a rejection. */
export type FirmwarePatchResult = { ok: true; hex: string } | { ok: false; error: FirmwarePatchProgramTooLargeError };

/** Inputs to {@link patchFirmwareHex}. */
export interface FirmwarePatchInput {
  /** The prebuilt firmware as Intel HEX text. */
  firmwareHex: string;
  /** Region placement metadata emitted by the firmware build. */
  metadata: FirmwareMetadata;
  /** The compiled binary `.mcprogram` to write into the region. */
  program: Uint8Array;
}

function regionMagicBytes(): Uint8Array {
  const bytes = new Uint8Array(ON_FLASH_REGION_MAGIC_HEX.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(ON_FLASH_REGION_MAGIC_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function regionPayload(program: Uint8Array): Uint8Array {
  const magic = regionMagicBytes();
  const payload = new Uint8Array(ON_FLASH_HEADER_SIZE + program.length);
  payload.set(magic, 0);
  payload[magic.length] = ON_FLASH_FORMAT_VERSION;
  payload.set(program, ON_FLASH_HEADER_SIZE);
  return payload;
}

/**
 * Patch `program` into `firmwareHex` at the region described by `metadata` and
 * return the corrected Intel HEX text. Rejects with
 * {@link FIRMWARE_PATCH_PROGRAM_TOO_LARGE} if the header plus program do not fit
 * the region. The transform is deterministic: identical inputs yield identical
 * output.
 */
export function patchFirmwareHex(input: FirmwarePatchInput): FirmwarePatchResult {
  const { firmwareHex, metadata, program } = input;
  const requiredBytes = ON_FLASH_HEADER_SIZE + program.length;
  if (requiredBytes > metadata.regionSize) {
    return {
      ok: false,
      error: { code: FIRMWARE_PATCH_PROGRAM_TOO_LARGE, requiredBytes, regionSize: metadata.regionSize },
    };
  }
  const records = encodeDataRecords(metadata.regionOffset, regionPayload(program));
  return { ok: true, hex: spliceRecordsBeforeEof(firmwareHex, records) };
}
