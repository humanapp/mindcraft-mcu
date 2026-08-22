import type { WendooEnvironment } from "@wendoo/core/app";
import { WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { createWodalEnvironment } from "../../../wendoo/environment";

/**
 * Creates a Wendoo environment with the core and microbit-v2 modules
 * installed, computing brain-observable numbers at the microbit-v2
 * profile's precision (f32).
 */
export function createMicroBitV2Environment(): WendooEnvironment {
  return createWodalEnvironment(WodalDeviceProfileId.MICROBIT_V2);
}
