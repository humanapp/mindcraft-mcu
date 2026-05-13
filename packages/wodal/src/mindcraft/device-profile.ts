import type { MindcraftModule } from "@mindcraft-lang/core/app";
import { createMicroBitV2Module } from "../targets/microbit-v2/mindcraft/module";

/** WODAL device profile identifiers. */
export const WodalDeviceProfileId = {
  MICROBIT_V2: "microbit-v2",
} as const;

/** Union of all {@link WodalDeviceProfileId} values. */
export type WodalDeviceProfileId = (typeof WodalDeviceProfileId)[keyof typeof WodalDeviceProfileId];

/** Mindcraft integration metadata for a WODAL device profile. */
export interface WodalDeviceProfile {
  /** Stable profile id used in WODAL project documents and build artifacts. */
  readonly profileId: WodalDeviceProfileId;

  /** Creates the Mindcraft module for this profile. */
  readonly createMindcraftModule: () => MindcraftModule;
}

/** Supported WODAL device profile ids. */
export const WODAL_DEVICE_PROFILE_IDS = Object.freeze([WodalDeviceProfileId.MICROBIT_V2] as const);

/** Supported WODAL device profiles keyed by profile id. */
export const WODAL_DEVICE_PROFILES = Object.freeze({
  [WodalDeviceProfileId.MICROBIT_V2]: Object.freeze({
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    createMindcraftModule: createMicroBitV2Module,
  } satisfies WodalDeviceProfile),
} satisfies Readonly<Record<WodalDeviceProfileId, WodalDeviceProfile>>);

/**
 * Checks whether a value is a supported WODAL device profile id.
 *
 * @param value - Candidate profile id.
 */
export function isWodalDeviceProfileId(value: unknown): value is WodalDeviceProfileId {
  return typeof value === "string" && (WODAL_DEVICE_PROFILE_IDS as readonly string[]).includes(value);
}

/**
 * Returns Mindcraft integration metadata for a supported WODAL device profile.
 *
 * @param profileId - Supported WODAL device profile id.
 */
export function getWodalDeviceProfile(profileId: WodalDeviceProfileId): WodalDeviceProfile {
  return WODAL_DEVICE_PROFILES[profileId];
}
