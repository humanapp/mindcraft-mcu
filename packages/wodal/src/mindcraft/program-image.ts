import type { WodalBytecodeImage } from "./bytecode-loader";
import { isWodalDeviceProfileId, type WodalDeviceProfileId } from "./device-profile-id";

/** Program image format identifier used by JSON-encoded `.mcprogram` files. */
export const WODAL_PROGRAM_IMAGE_FORMAT = "mindcraft.program";

/** Program image envelope version accepted by WODAL. */
export const WODAL_PROGRAM_IMAGE_VERSION = 1;

/** Binary `.mcprogram` magic bytes for Mindcraft program images. */
export const WODAL_BINARY_PROGRAM_IMAGE_MAGIC = [0x4d, 0x43, 0x50, 0x52, 0x4f, 0x47] as const;

/** Program image encodings recognized by the WODAL program image reader. */
export const WodalProgramImageEncoding = {
  JSON: "json",
  BINARY: "binary",
} as const;

/** Union of all {@link WodalProgramImageEncoding} values. */
export type WodalProgramImageEncoding = (typeof WodalProgramImageEncoding)[keyof typeof WodalProgramImageEncoding];

/** Validation code constants used by WODAL program image diagnostics. */
export const WodalProgramImageValidationCode = {
  INVALID_PROGRAM_IMAGE_ENCODING: "WODAL_PROGRAM_IMAGE_INVALID_ENCODING",
  UNSUPPORTED_BINARY_PROGRAM_IMAGE: "WODAL_PROGRAM_IMAGE_UNSUPPORTED_BINARY_ENCODING",
  INVALID_PROGRAM_IMAGE_JSON: "WODAL_PROGRAM_IMAGE_INVALID_JSON",
  INVALID_PROGRAM_IMAGE_ROOT: "WODAL_PROGRAM_IMAGE_INVALID_ROOT",
  INVALID_PROGRAM_IMAGE_FORMAT: "WODAL_PROGRAM_IMAGE_INVALID_FORMAT",
  INVALID_PROGRAM_IMAGE_VERSION: "WODAL_PROGRAM_IMAGE_INVALID_VERSION",
  UNSUPPORTED_PROGRAM_IMAGE_PROFILE: "WODAL_PROGRAM_IMAGE_UNSUPPORTED_PROFILE",
  MISSING_PROGRAM_IMAGE_PROGRAM: "WODAL_PROGRAM_IMAGE_MISSING_PROGRAM",
} as const;

/** Union of all {@link WodalProgramImageValidationCode} values. */
export type WodalProgramImageValidationCode =
  (typeof WodalProgramImageValidationCode)[keyof typeof WodalProgramImageValidationCode];

/** Serialized Mindcraft program image envelope consumed by WODAL. */
export interface WodalProgramImage<TProgram = unknown> {
  /** Program image format identifier. */
  readonly format: typeof WODAL_PROGRAM_IMAGE_FORMAT;

  /** Program image envelope version. */
  readonly version: typeof WODAL_PROGRAM_IMAGE_VERSION;

  /** WODAL device profile required by the program image. */
  readonly profileId: WodalDeviceProfileId;

  /** Linked Mindcraft program payload. */
  readonly program: TProgram;
}

/** Validation diagnostic for a rejected program image. */
export interface WodalProgramImageValidationError {
  /** Stable machine-readable validation code. */
  readonly code: WodalProgramImageValidationCode;

  /** JSON path of the rejected field, or `$` for non-JSON input. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;
}

/** Result of validating or parsing a WODAL program image. */
export type WodalProgramImageParseResult<TProgram = unknown> =
  | {
      /** True when a valid program image was produced. */
      readonly ok: true;

      /** Encoding used by the parsed program image. */
      readonly encoding: typeof WodalProgramImageEncoding.JSON;

      /** Parsed program image envelope. */
      readonly image: WodalProgramImage<TProgram>;

      /** Empty diagnostics list for a valid image. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the image. */
      readonly ok: false;

      /** Encoding detected before validation failed, when available. */
      readonly encoding?: WodalProgramImageEncoding;

      /** Validation diagnostics. */
      readonly errors: readonly WodalProgramImageValidationError[];
    };

/**
 * Parses a `.mcprogram` image from JSON text or bytes.
 *
 * @param input - Program image contents.
 */
export function parseWodalProgramImage(input: string | Uint8Array): WodalProgramImageParseResult {
  if (typeof input === "string") {
    return parseWodalProgramImageJson(input);
  }

  const encoding = detectWodalProgramImageEncoding(input);
  if (encoding === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ENCODING,
          path: "$",
          message: "Program image encoding is not recognized.",
        },
      ],
    };
  }

  if (encoding === WodalProgramImageEncoding.BINARY) {
    return {
      ok: false,
      encoding,
      errors: [
        {
          code: WodalProgramImageValidationCode.UNSUPPORTED_BINARY_PROGRAM_IMAGE,
          path: "$",
          message: "Binary program image encoding is not supported by this reader.",
        },
      ],
    };
  }

  return parseWodalProgramImageJson(new TextDecoder().decode(input));
}

/**
 * Validates a parsed JSON program image envelope.
 *
 * @param value - Parsed JSON value from a program image.
 */
export function validateWodalProgramImage(value: unknown): WodalProgramImageParseResult {
  if (!isRecord(value)) {
    return {
      ok: false,
      encoding: WodalProgramImageEncoding.JSON,
      errors: [
        {
          code: WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ROOT,
          path: "$",
          message: "Program image root must be an object.",
        },
      ],
    };
  }

  const errors: WodalProgramImageValidationError[] = [];
  const format = readString(
    value,
    "format",
    "$.format",
    WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
    errors
  );
  const version = readNumber(
    value,
    "version",
    "$.version",
    WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
    errors
  );
  const profileId = readString(
    value,
    "profileId",
    "$.profileId",
    WodalProgramImageValidationCode.UNSUPPORTED_PROGRAM_IMAGE_PROFILE,
    errors
  );
  const program = value.program;

  if (format !== undefined && format !== WODAL_PROGRAM_IMAGE_FORMAT) {
    errors.push({
      code: WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
      path: "$.format",
      message: `Program image format must be "${WODAL_PROGRAM_IMAGE_FORMAT}".`,
    });
  }

  if (version !== undefined && version !== WODAL_PROGRAM_IMAGE_VERSION) {
    errors.push({
      code: WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
      path: "$.version",
      message: `Program image version must be ${WODAL_PROGRAM_IMAGE_VERSION}.`,
    });
  }

  if (profileId !== undefined && !isWodalDeviceProfileId(profileId)) {
    errors.push({
      code: WodalProgramImageValidationCode.UNSUPPORTED_PROGRAM_IMAGE_PROFILE,
      path: "$.profileId",
      message: "Program image profileId is not supported.",
    });
  }

  if (program === undefined || program === null) {
    errors.push({
      code: WodalProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM,
      path: "$.program",
      message: "Program image program payload is required.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, encoding: WodalProgramImageEncoding.JSON, errors };
  }

  return {
    ok: true,
    encoding: WodalProgramImageEncoding.JSON,
    image: {
      format: WODAL_PROGRAM_IMAGE_FORMAT,
      version: WODAL_PROGRAM_IMAGE_VERSION,
      profileId: profileId as WodalDeviceProfileId,
      program,
    },
    errors: [],
  };
}

/**
 * Converts a validated program image envelope into the current loader image shape.
 *
 * @param image - Program image envelope returned by validation or parsing.
 */
export function wodalProgramImageToBytecodeImage<TProgram>(
  image: WodalProgramImage<TProgram>
): WodalBytecodeImage<TProgram> {
  return {
    version: image.version,
    program: image.program,
  };
}

function parseWodalProgramImageJson(content: string): WodalProgramImageParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      ok: false,
      encoding: WodalProgramImageEncoding.JSON,
      errors: [
        {
          code: WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_JSON,
          path: "$",
          message: "Program image is not valid JSON.",
        },
      ],
    };
  }

  return validateWodalProgramImage(parsed);
}

function detectWodalProgramImageEncoding(bytes: Uint8Array): WodalProgramImageEncoding | undefined {
  const firstByte = firstContentByte(bytes);
  if (firstByte === undefined) {
    return undefined;
  }
  if (firstByte === 0x7b || firstByte === 0x5b) {
    return WodalProgramImageEncoding.JSON;
  }
  return hasBinaryMagic(bytes) ? WodalProgramImageEncoding.BINARY : undefined;
}

function firstContentByte(bytes: Uint8Array): number | undefined {
  for (const byte of bytes) {
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) {
      return byte;
    }
  }
  return undefined;
}

function hasBinaryMagic(bytes: Uint8Array): boolean {
  if (bytes.length < WODAL_BINARY_PROGRAM_IMAGE_MAGIC.length) {
    return false;
  }
  for (let index = 0; index < WODAL_BINARY_PROGRAM_IMAGE_MAGIC.length; index += 1) {
    if (bytes[index] !== WODAL_BINARY_PROGRAM_IMAGE_MAGIC[index]) {
      return false;
    }
  }
  return true;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: WodalProgramImageValidationCode,
  errors: WodalProgramImageValidationError[]
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") {
    errors.push({
      code,
      path,
      message: `${path} must be a string.`,
    });
    return undefined;
  }
  return value;
}

function readNumber(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: WodalProgramImageValidationCode,
  errors: WodalProgramImageValidationError[]
): number | undefined {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push({
      code,
      path,
      message: `${path} must be an integer.`,
    });
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
