/**
 * Brain-to-firmware packaging for the per-brain deploy links: serializes a built
 * WODAL program image to its binary `.mcprogram` bytes and patches them into the
 * bundled firmware's on-flash region, returning a distributable Intel HEX.
 *
 * For identical firmware and program, the patched hex is byte-identical to the
 * `wodal patch` CLI's output.
 */

import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@wendoo-lang/core/runtime";
import {
  type FirmwareMetadata,
  type FirmwarePatchResult,
  patchFirmwareHex,
  serializeWodalProgramImageJson,
  type WodalProgramImage,
  wodalProgramBytes,
} from "@wendoo-lang/wodal";

/**
 * Serializes a built program image to the binary `.mcprogram` payload the patcher
 * writes into the firmware region.
 */
export function programBytesFromImage(image: WodalProgramImage<LinkedBrainProgram>): Uint8Array {
  return wodalProgramBytes(new TextEncoder().encode(programJsonFromImage(image)));
}

/** Serializes a built program image to the JSON `.mcprogram` text. */
export function programJsonFromImage(image: WodalProgramImage<LinkedBrainProgram>): string {
  return serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) });
}

/**
 * Patches the program bytes of `image` into `firmwareHex` at the region described by
 * `metadata`, returning the patched Intel HEX or a `program-too-large` rejection.
 */
export function patchFirmwareForImage(
  image: WodalProgramImage<LinkedBrainProgram>,
  firmwareHex: string,
  metadata: FirmwareMetadata
): FirmwarePatchResult {
  return patchFirmwareHex({ firmwareHex, metadata, program: programBytesFromImage(image) });
}
