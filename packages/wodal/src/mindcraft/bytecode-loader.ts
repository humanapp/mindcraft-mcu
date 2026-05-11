import { UINT16_MAX } from "../core/numeric";

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
  readonly errors: readonly string[];
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
    const errors: string[] = [];
    if (!Number.isInteger(image.version) || image.version < 1 || image.version > UINT16_MAX) {
      errors.push("Invalid bytecode version.");
    }
    if (image.program === undefined || image.program === null) {
      errors.push("Missing bytecode program.");
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
