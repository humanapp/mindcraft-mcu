import { stream } from "@mindcraft-lang/core";
import {
  type LinkedBrainProgram,
  linkedBrainProgramFromBytes,
  linkedBrainProgramToBytes,
} from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, type WodalDeviceProfileId } from "./device-profile";
import type { WodalProgramImage } from "./program-image";

/** Decoded binary WODAL program image: the device profile id plus the hydrated linked brain program. */
export interface WodalBinaryProgramImage {
  /** Device profile the binary was built for. */
  readonly profileId: WodalDeviceProfileId;

  /** Linked brain program hydrated from the binary payload. */
  readonly program: LinkedBrainProgram;
}

/**
 * Emits the compact binary `.mcprogram` form of a built WODAL program image.
 * Numbers are encoded at the profile's precision (f32 for microbit-v2) and the
 * profile's numeric id is written into the envelope header.
 *
 * @param image - Built WODAL program image to serialize.
 */
export function serializeWodalProgramImageBytes(image: WodalProgramImage<LinkedBrainProgram>): Uint8Array {
  const profile = getWodalDeviceProfile(image.profileId);
  const bytes = linkedBrainProgramToBytes(image.program, {
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
  });
  return stream.byteArrayToUint8Array(bytes) as Uint8Array;
}

/**
 * Parses a binary `.mcprogram` payload into a linked brain program for the given
 * device profile. Decodes numbers at the profile's precision and verifies the
 * envelope's numeric profile id matches the expected profile.
 *
 * @param data - Binary `.mcprogram` bytes.
 * @param profileId - Device profile the binary is expected to target.
 */
export function parseWodalProgramImageBytes(
  data: Uint8Array,
  profileId: WodalDeviceProfileId
): WodalBinaryProgramImage {
  const profile = getWodalDeviceProfile(profileId);
  const result = linkedBrainProgramFromBytes(stream.byteArrayFromUint8Array(data), {
    precision: profile.numberPrecision,
  });
  if (result.profileId !== profile.numericProfileId) {
    throw new Error(
      `binary .mcprogram profile id ${result.profileId} does not match expected '${profileId}' (${profile.numericProfileId})`
    );
  }
  return { profileId, program: result.program };
}
