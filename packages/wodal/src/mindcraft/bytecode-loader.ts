import { UINT16_MAX } from "../core/numeric";

/** Stable bytecode validation error code. */
export const WodalBytecodeValidationCode = {
  INVALID_BYTECODE_VERSION: "INVALID_BYTECODE_VERSION",
  MISSING_BYTECODE_PROGRAM: "MISSING_BYTECODE_PROGRAM",
  INVALID_SERIALIZED_PROGRAM: "INVALID_SERIALIZED_PROGRAM",
  UNSUPPORTED_DEVICE_PROFILE: "UNSUPPORTED_DEVICE_PROFILE",
} as const;

/** Union of all {@link WodalBytecodeValidationCode} values. */
export type WodalBytecodeValidationCode =
  (typeof WodalBytecodeValidationCode)[keyof typeof WodalBytecodeValidationCode];

/** Validation diagnostic for a rejected bytecode image. */
export interface WodalBytecodeValidationError {
  /** Stable machine-readable validation code. */
  readonly code: WodalBytecodeValidationCode;

  /** Human-readable diagnostic message. */
  readonly message: string;

  /** Optional thrown value associated with the diagnostic. */
  readonly cause?: unknown;
}

/** Bytecode image accepted by raw WODAL loader entry points. */
export interface WodalBytecodeImage<TPayload = unknown> {
  /** Bytecode format version. */
  readonly version: number;

  /** Linked Mindcraft bytecode payload owned by the compiler side. */
  readonly program: TPayload;
}

/** Result of validating a bytecode image. */
export interface WodalBytecodeValidation {
  /** True when the image can be installed. */
  readonly ok: boolean;

  /** Validation diagnostics for rejected images. */
  readonly errors: readonly WodalBytecodeValidationError[];
}

/**
 * Validates a raw bytecode image envelope.
 *
 * @param image - Candidate image.
 */
export function validateWodalBytecodeImage<TPayload>(image: WodalBytecodeImage<TPayload>): WodalBytecodeValidation {
  const errors: WodalBytecodeValidationError[] = [];
  if (!Number.isInteger(image.version) || image.version < 1 || image.version > UINT16_MAX) {
    errors.push({
      code: WodalBytecodeValidationCode.INVALID_BYTECODE_VERSION,
      message: "Invalid bytecode version.",
    });
  }
  if (image.program === undefined || image.program === null) {
    errors.push({
      code: WodalBytecodeValidationCode.MISSING_BYTECODE_PROGRAM,
      message: "Missing bytecode program.",
    });
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}
