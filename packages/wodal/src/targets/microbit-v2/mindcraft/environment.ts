import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { createWodalEnvironment } from "../../../mindcraft/environment";

/**
 * Creates a Mindcraft environment with the core and microbit-v2 modules
 * installed, computing brain-observable numbers at the microbit-v2
 * profile's precision (f32).
 */
export function createMicroBitV2Environment(): MindcraftEnvironment {
  return createWodalEnvironment(WodalDeviceProfileId.MICROBIT_V2);
}
