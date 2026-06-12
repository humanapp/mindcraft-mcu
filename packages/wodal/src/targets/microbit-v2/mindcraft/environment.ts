import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { createProfileNumerics } from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";

/**
 * Creates a Mindcraft environment with the core and microbit-v2 modules
 * installed, computing brain-observable numbers at the microbit-v2
 * profile's precision (f32).
 */
export function createMicroBitV2Environment(): MindcraftEnvironment {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  return createMindcraftEnvironment({
    modules: [coreModule(), profile.createMindcraftModule()],
    numerics: createProfileNumerics(profile.numberPrecision),
  });
}
