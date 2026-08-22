import type { TargetAdapter, TargetManifest } from "@wendoo-lang/assistant-bridge";
import type { RehearsalWorld, WorldDriver, WorldStaging } from "@wendoo-lang/assistant-bridge/kit";
import { createRehearsalAdapter } from "@wendoo-lang/assistant-bridge/kit";
import type { NumberPrecision } from "@wendoo-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { createWodalSharedModule } from "../../../wendoo/shared-module";
import { microBitV2TileDocs } from "./tile-docs";
import { createDeviceWorld, PERCEPT_KINDS, STATE_CHANNELS } from "./world";

/** The device profile this adapter authors for and rehearses against. */
const PROFILE = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);

/** The one population role a scenario may put under study: the device itself. */
const DEVICE_SUBJECT = "device";

const MANIFEST: TargetManifest = {
  target: "a pocket computer with a 5x5 LED screen, two buttons, and a handful of senses",
  thing: "their device",
  provides: [
    "The device can feel its two front buttons and its touch logo, and can tell how bright the room is and how warm it is.",
    "The device can feel how it is being moved: shaken, tilted, turned face up or face down, or dropped.",
    "The device can light pixels on its screen, show pictures and scrolling text, and play sounds.",
    "The device can send and receive radio messages to and from other devices on the same group.",
  ],
};

/**
 * The device world driver: one device, running the brain under study at a fixed
 * timestep, with the scenario's percepts injected through the device's own
 * host-input seams.
 */
const driver: WorldDriver = {
  modules: () => [createWodalSharedModule(), PROFILE.createWendooModule()],
  subjects: () => [DEVICE_SUBJECT],
  inputKinds: () => PERCEPT_KINDS,
  stateChannels: () => STATE_CHANNELS,
  precision: (): NumberPrecision => PROFILE.numberPrecision,
  stage: (staging: WorldStaging): Promise<RehearsalWorld> => Promise.resolve(createDeviceWorld(staging)),
};

/**
 * This target's adapter: installs the device's tiles for authoring, and
 * rehearses a brain by running it headlessly on one simulated device at the
 * device profile's numeric precision.
 *
 * @param targetIdentity Wendoo identity the adapter reports, as the
 * `identity` the target package distributing this device declares.
 */
export function createTargetAdapter(targetIdentity: string): TargetAdapter {
  return createRehearsalAdapter({
    targetIdentity,
    manifest: MANIFEST,
    tileDocs: microBitV2TileDocs,
    driver,
  });
}
