import type { LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import {
  WODAL_PROGRAM_IMAGE_FORMAT,
  WODAL_PROGRAM_IMAGE_VERSION,
  type WodalProgramImage,
} from "../../../mindcraft/program-image";

/**
 * Creates a WODAL program image for the microbit-v2 runtime.
 *
 * @param program - Linked Mindcraft brain program for the microbit-v2 profile.
 */
export function createMicroBitV2ProgramImage(program: LinkedBrainProgram): WodalProgramImage<LinkedBrainProgram> {
  return {
    format: WODAL_PROGRAM_IMAGE_FORMAT,
    version: WODAL_PROGRAM_IMAGE_VERSION,
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    program,
  };
}
