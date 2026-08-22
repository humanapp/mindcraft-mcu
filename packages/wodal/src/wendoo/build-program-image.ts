import type { LinkedBrainProgram } from "@wendoo-lang/core/runtime";
import { getWodalDeviceProfile, type WodalDeviceProfileId } from "./device-profile";
import type { WodalProgramImage } from "./program-image";

/** Input for creating a WODAL program image through the device profile registry. */
export interface WodalProgramImageCreateOptions {
  /** Selected WODAL device profile id. */
  readonly profileId: WodalDeviceProfileId;

  /** Linked Wendoo brain program for the selected profile. */
  readonly program: LinkedBrainProgram;
}

/**
 * Creates a WODAL program image through the selected device profile.
 *
 * @param options - Selected profile and linked brain program.
 */
export function createWodalProgramImage(
  options: WodalProgramImageCreateOptions
): WodalProgramImage<LinkedBrainProgram> {
  return getWodalDeviceProfile(options.profileId).createProgramImage(options.program);
}
