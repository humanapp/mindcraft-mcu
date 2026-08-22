import { stream } from "@wendoo-lang/core";
import {
  type ITypeRegistry,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromBytes,
  linkedBrainProgramFromJson,
  linkedBrainProgramToBytes,
} from "@wendoo-lang/core/runtime";
import { detectWendooProgramImageEncoding, WendooProgramImageEncoding } from "@wendoo-lang/service-api";
import { getWodalDeviceProfile, type WodalDeviceProfileId } from "./device-profile";
import { createWodalEnvironment } from "./environment";
import { parseWodalProgramImage, type WodalProgramImage } from "./program-image";

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
 * @param typeRegistry - Type registry resolving atom-enum symbol ordinals.
 */
export function serializeWodalProgramImageBytes(
  image: WodalProgramImage<LinkedBrainProgram>,
  typeRegistry?: ITypeRegistry
): Uint8Array {
  const profile = getWodalDeviceProfile(image.profileId);
  const bytes = linkedBrainProgramToBytes(image.program, {
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
    typeRegistry,
  });
  return stream.byteArrayToUint8Array(bytes) as Uint8Array;
}

/**
 * Returns the binary `.mcprogram` payload to write into a firmware region from
 * either form of a compiled program: binary `.mcprogram` bytes are returned
 * unchanged, and a JSON `.mcprogram` image is serialized to the binary form of
 * the profile named in its envelope. Throws if the JSON image is invalid or
 * targets a profile WODAL does not support.
 *
 * @param content - Raw `.mcprogram` file contents, binary or JSON.
 */
export function wodalProgramBytes(content: Uint8Array): Uint8Array {
  if (detectWendooProgramImageEncoding(content) === WendooProgramImageEncoding.BINARY) {
    return content;
  }
  const parsed = parseWodalProgramImage(content);
  if (!parsed.ok) {
    throw new Error(`invalid JSON .mcprogram: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }
  const program = linkedBrainProgramFromJson(parsed.image.program as LinkedBrainProgramJson);
  const image = getWodalDeviceProfile(parsed.image.profileId).createProgramImage(program);
  const typeRegistry = createWodalEnvironment(parsed.image.profileId).brainServices.runtime.types;
  return serializeWodalProgramImageBytes(image, typeRegistry);
}

/**
 * Parses a binary `.mcprogram` payload into a linked brain program for the given
 * device profile. Decodes numbers at the profile's precision and verifies the
 * envelope's numeric profile id matches the expected profile.
 *
 * @param data - Binary `.mcprogram` bytes.
 * @param profileId - Device profile the binary is expected to target.
 * @param typeRegistry - Type registry of the decoding runtime; resolves TYPS atom entries.
 */
export function parseWodalProgramImageBytes(
  data: Uint8Array,
  profileId: WodalDeviceProfileId,
  typeRegistry: ITypeRegistry
): WodalBinaryProgramImage {
  const profile = getWodalDeviceProfile(profileId);
  const result = linkedBrainProgramFromBytes(stream.byteArrayFromUint8Array(data), {
    precision: profile.numberPrecision,
    typeRegistry,
  });
  if (result.profileId !== profile.numericProfileId) {
    throw new Error(
      `binary .mcprogram profile id ${result.profileId} does not match expected '${profileId}' (${profile.numericProfileId})`
    );
  }
  return { profileId, program: result.program };
}
