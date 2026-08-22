import type { LinkedBrainProgram } from "@wendoo-lang/core/runtime";
import { WENDOO_PROGRAM_IMAGE_FORMAT, WENDOO_PROGRAM_IMAGE_VERSION } from "@wendoo-lang/service-api";
import { WodalDeviceProfileId } from "../../../wendoo/device-profile-id";
import type { WodalProgramImage } from "../../../wendoo/program-image";

/**
 * Creates a WODAL program image for the microbit-v2 runtime.
 *
 * @param program - Linked Wendoo brain program for the microbit-v2 profile.
 */
export function createMicroBitV2ProgramImage(program: LinkedBrainProgram): WodalProgramImage<LinkedBrainProgram> {
  return {
    format: WENDOO_PROGRAM_IMAGE_FORMAT,
    version: WENDOO_PROGRAM_IMAGE_VERSION,
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    program,
  };
}
