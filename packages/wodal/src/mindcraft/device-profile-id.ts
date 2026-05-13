/** WODAL device profile identifiers. */
export const WodalDeviceProfileId = {
  MICROBIT_V2: "microbit-v2",
} as const;

/** Union of all {@link WodalDeviceProfileId} values. */
export type WodalDeviceProfileId = (typeof WodalDeviceProfileId)[keyof typeof WodalDeviceProfileId];

/** Supported WODAL device profile ids. */
export const WODAL_DEVICE_PROFILE_IDS = Object.freeze([WodalDeviceProfileId.MICROBIT_V2] as const);

/**
 * Checks whether a value is a supported WODAL device profile id.
 *
 * @param value - Candidate profile id.
 */
export function isWodalDeviceProfileId(value: unknown): value is WodalDeviceProfileId {
  return typeof value === "string" && (WODAL_DEVICE_PROFILE_IDS as readonly string[]).includes(value);
}
