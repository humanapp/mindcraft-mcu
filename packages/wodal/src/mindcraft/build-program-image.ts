import type { LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, type WodalDeviceProfileId } from "./device-profile";
import type { WodalProgramImage } from "./program-image";

/** Input for creating a WODAL program image through the device profile registry. */
export interface CreateWodalProgramImageForProfileOptions {
  /** Selected WODAL device profile id. */
  readonly profileId: WodalDeviceProfileId;

  /** Linked Mindcraft brain program for the selected profile. */
  readonly program: LinkedBrainProgram;
}

/**
 * Creates a WODAL program image through the selected device profile.
 *
 * @param options - Selected profile and linked brain program.
 */
export function createWodalProgramImageForProfile(
  options: CreateWodalProgramImageForProfileOptions
): WodalProgramImage<LinkedBrainProgram> {
  return getWodalDeviceProfile(options.profileId).createProgramImage(options.program);
}
