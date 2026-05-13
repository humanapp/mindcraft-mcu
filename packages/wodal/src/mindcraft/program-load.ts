/** Stable program load validation error code. */
export const WodalProgramLoadValidationCode = {
  INVALID_SERIALIZED_PROGRAM: "WODAL_PROGRAM_LOAD_INVALID_SERIALIZED_PROGRAM",
  UNSUPPORTED_DEVICE_PROFILE: "WODAL_PROGRAM_LOAD_UNSUPPORTED_DEVICE_PROFILE",
} as const;

/** Union of all {@link WodalProgramLoadValidationCode} values. */
export type WodalProgramLoadValidationCode =
  (typeof WodalProgramLoadValidationCode)[keyof typeof WodalProgramLoadValidationCode];

/** Validation diagnostic for a rejected program load request. */
export interface WodalProgramLoadValidationError {
  /** Stable machine-readable validation code. */
  readonly code: WodalProgramLoadValidationCode;

  /** Human-readable diagnostic message. */
  readonly message: string;

  /** Optional thrown value associated with the diagnostic. */
  readonly cause?: unknown;
}

/** Result of validating and loading a program image. */
export interface WodalProgramLoadValidation {
  /** True when the program image was installed. */
  readonly ok: boolean;

  /** Validation diagnostics for rejected program images. */
  readonly errors: readonly WodalProgramLoadValidationError[];
}
