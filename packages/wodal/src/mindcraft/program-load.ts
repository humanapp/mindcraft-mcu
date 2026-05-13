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

/** Successful program image load result. */
export interface WodalProgramLoadSuccess {
  /** Indicates that the program image was installed. */
  readonly ok: true;
}

/** Failed program image load result. */
export interface WodalProgramLoadFailure {
  /** Indicates that the program image was rejected. */
  readonly ok: false;

  /** Validation diagnostics for the rejected program image. */
  readonly errors: readonly [WodalProgramLoadValidationError, ...WodalProgramLoadValidationError[]];
}

/** Result of validating and loading a program image. */
export type WodalProgramLoadValidation = WodalProgramLoadSuccess | WodalProgramLoadFailure;
