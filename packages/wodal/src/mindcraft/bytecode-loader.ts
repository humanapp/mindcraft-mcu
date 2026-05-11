import { UINT16_MAX } from "../core/numeric";

/** Validation code for a missing or unsupported bytecode image version. */
export const INVALID_BYTECODE_VERSION = "INVALID_BYTECODE_VERSION";

/** Validation code for a bytecode image without a program payload. */
export const MISSING_BYTECODE_PROGRAM = "MISSING_BYTECODE_PROGRAM";

/** Stable bytecode validation error code. */
export type WodalBytecodeValidationCode = typeof INVALID_BYTECODE_VERSION | typeof MISSING_BYTECODE_PROGRAM;

/** Validation diagnostic for a rejected bytecode image. */
export interface WodalBytecodeValidationError {
  /** Stable machine-readable validation code. */
  readonly code: WodalBytecodeValidationCode;

  /** Human-readable diagnostic message. */
  readonly message: string;
}

/** Bytecode image accepted by the WODAL loader facade. */
export interface WodalBytecodeImage {
  /** Bytecode format version. */
  readonly version: number;

  /** Linked Mindcraft bytecode payload owned by the compiler side. */
  readonly program: unknown;
}

/** Result of validating a bytecode image. */
export interface WodalBytecodeValidation {
  /** True when the image can be installed. */
  readonly ok: boolean;

  /** Validation diagnostics for rejected images. */
  readonly errors: readonly WodalBytecodeValidationError[];
}

/** Minimal bytecode loader facade for future serial and flash integration. */
export class WodalBytecodeLoader {
  private activeImage: WodalBytecodeImage | undefined;

  /**
   * Validates an image envelope.
   *
   * @param image - Candidate image.
   */
  validate(image: WodalBytecodeImage): WodalBytecodeValidation {
    const errors: WodalBytecodeValidationError[] = [];
    if (!Number.isInteger(image.version) || image.version < 1 || image.version > UINT16_MAX) {
      errors.push({
        code: INVALID_BYTECODE_VERSION,
        message: "Invalid bytecode version.",
      });
    }
    if (image.program === undefined || image.program === null) {
      errors.push({
        code: MISSING_BYTECODE_PROGRAM,
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
  load(image: WodalBytecodeImage): WodalBytecodeValidation {
    const validation = this.validate(image);
    if (validation.ok) {
      this.activeImage = image;
    }
    return validation;
  }

  /** Returns the active image, if one has been installed. */
  getActiveImage(): WodalBytecodeImage | undefined {
    return this.activeImage;
  }

  /** Clears the active image. */
  reset(): void {
    this.activeImage = undefined;
  }
}
