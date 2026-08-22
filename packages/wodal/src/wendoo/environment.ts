import { coreModule, createWendooEnvironment, type WendooEnvironment } from "@wendoo/core/app";
import { createProfileNumerics } from "@wendoo/core/runtime";
import { getWodalDeviceProfile } from "./device-profile";
import type { WodalDeviceProfileId } from "./device-profile-id";
import { createWodalSharedModule } from "./shared-module";

/**
 * Creates a Wendoo environment for a WODAL device profile: the core module,
 * the wodal-shared module, and the profile's target module, computing
 * brain-observable numbers at the profile's precision.
 *
 * @param profileId - Supported WODAL device profile id.
 */
export function createWodalEnvironment(profileId: WodalDeviceProfileId): WendooEnvironment {
  const profile = getWodalDeviceProfile(profileId);
  return createWendooEnvironment({
    modules: [coreModule(), createWodalSharedModule(), profile.createWendooModule()],
    numerics: createProfileNumerics(profile.numberPrecision),
  });
}
