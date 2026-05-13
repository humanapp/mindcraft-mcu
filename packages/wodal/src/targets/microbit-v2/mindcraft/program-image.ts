import type { LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { MINDCRAFT_PROGRAM_IMAGE_FORMAT, MINDCRAFT_PROGRAM_IMAGE_VERSION } from "@mindcraft-lang/service-api";
import { WodalDeviceProfileId } from "../../../mindcraft/device-profile-id";
import type { WodalProgramImage } from "../../../mindcraft/program-image";

/**
 * Creates a WODAL program image for the microbit-v2 runtime.
 *
 * @param program - Linked Mindcraft brain program for the microbit-v2 profile.
 */
export function createMicroBitV2ProgramImage(program: LinkedBrainProgram): WodalProgramImage<LinkedBrainProgram> {
  return {
    format: MINDCRAFT_PROGRAM_IMAGE_FORMAT,
    version: MINDCRAFT_PROGRAM_IMAGE_VERSION,
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    program,
  };
}
