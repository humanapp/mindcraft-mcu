import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { createProfileNumerics } from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile } from "./device-profile";
import type { WodalDeviceProfileId } from "./device-profile-id";
import { createWodalSharedModule } from "./shared-module";

/**
 * Creates a Mindcraft environment for a WODAL device profile: the core module,
 * the wodal-shared module, and the profile's target module, computing
 * brain-observable numbers at the profile's precision.
 *
 * @param profileId - Supported WODAL device profile id.
 */
export function createWodalEnvironment(profileId: WodalDeviceProfileId): MindcraftEnvironment {
  const profile = getWodalDeviceProfile(profileId);
  return createMindcraftEnvironment({
    modules: [coreModule(), createWodalSharedModule(), profile.createMindcraftModule()],
    numerics: createProfileNumerics(profile.numberPrecision),
  });
}
