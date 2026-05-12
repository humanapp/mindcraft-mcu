/** Error code constants used by WODAL APIs. */
export const WodalErrorCode = {
  MISSING_WODAL_PROGRAM: "MISSING_WODAL_PROGRAM",
} as const;

/** Union of all {@link WodalErrorCode} values. */
export type WodalErrorCode = (typeof WodalErrorCode)[keyof typeof WodalErrorCode];

/**
 * Error thrown by WODAL APIs.
 *
 * Match {@link code} in tests and app logic. The inherited `message` property
 * is a human-readable description.
 */
export class WodalError extends Error {
  /** Stable error identifier. */
  readonly code: WodalErrorCode;

  /**
   * Creates a WODAL API error.
   *
   * @param code - Stable error identifier.
   * @param message - Human-readable description.
   */
  constructor(code: WodalErrorCode, message: string) {
    super(message);
    this.name = "WodalError";
    this.code = code;
  }
}

/** Create a {@link WodalError} with a stable code and descriptive message. */
export function wodalError(code: WodalErrorCode, message: string): WodalError {
  return new WodalError(code, message);
}
