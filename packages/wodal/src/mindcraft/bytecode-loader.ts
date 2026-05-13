import { UINT16_MAX } from "../core/numeric";

/** Stable bytecode validation error code. */
export const WodalBytecodeValidationCode = {
  INVALID_BYTECODE_VERSION: "INVALID_BYTECODE_VERSION",
  MISSING_BYTECODE_PROGRAM: "MISSING_BYTECODE_PROGRAM",
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
}

/** Bytecode image accepted by the WODAL loader facade. */
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

/** Minimal bytecode loader facade for future serial and flash integration. */
export class WodalBytecodeLoader<TPayload = unknown> {
  private activeImage: WodalBytecodeImage<TPayload> | undefined;

  /**
   * Validates an image envelope.
   *
   * @param image - Candidate image.
   */
  validate(image: WodalBytecodeImage<TPayload>): WodalBytecodeValidation {
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

  /**
   * Installs a validated bytecode image.
   *
   * @param image - Image to activate.
   * @returns Validation result.
   */
  load(image: WodalBytecodeImage<TPayload>): WodalBytecodeValidation {
    const validation = this.validate(image);
    if (validation.ok) {
      this.activeImage = image;
    }
    return validation;
  }

  /** Returns the active image, if one has been installed. */
  getActiveImage(): WodalBytecodeImage<TPayload> | undefined {
    return this.activeImage;
  }

  /** Clears the active image. */
  reset(): void {
    this.activeImage = undefined;
  }
}
