import {
  detectMindcraftProgramImageEncoding,
  type MindcraftProgramImage,
  MindcraftProgramImageEncoding,
  type MindcraftProgramImageParseResult,
  MindcraftProgramImageValidationCode,
  type MindcraftProgramImageValidationError,
  serializeMindcraftProgramImageJson,
  validateMindcraftProgramImage,
} from "@mindcraft-lang/service-api";
import type { WodalBytecodeImage } from "./bytecode-loader";
import { isWodalDeviceProfileId, type WodalDeviceProfileId } from "./device-profile-id";

/** Validation code constants used by WODAL program image diagnostics. */
export const WodalProgramImageValidationCode = {
  ...MindcraftProgramImageValidationCode,
  UNSUPPORTED_PROGRAM_IMAGE_PROFILE: "WODAL_PROGRAM_IMAGE_UNSUPPORTED_PROFILE",
} as const;

/** Union of all {@link WodalProgramImageValidationCode} values. */
export type WodalProgramImageValidationCode =
  (typeof WodalProgramImageValidationCode)[keyof typeof WodalProgramImageValidationCode];

/** Serialized Mindcraft program image envelope accepted by WODAL. */
export type WodalProgramImage<TProgram = unknown> = MindcraftProgramImage<TProgram, WodalDeviceProfileId>;

/** Validation diagnostic for a rejected WODAL program image. */
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
      /** True when a valid WODAL program image was produced. */
      readonly ok: true;

      /** Encoding used by the parsed program image. */
      readonly encoding: typeof MindcraftProgramImageEncoding.JSON;

      /** Parsed program image envelope. */
      readonly image: WodalProgramImage<TProgram>;

      /** Empty diagnostics list for a valid image. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the image. */
      readonly ok: false;

      /** Encoding detected before validation failed, when available. */
      readonly encoding?: MindcraftProgramImageEncoding;

      /** Validation diagnostics. */
      readonly errors: readonly WodalProgramImageValidationError[];
    };

/**
 * Parses a `.mcprogram` image from JSON text or bytes and validates it for WODAL.
 *
 * @param input - Program image contents.
 */
export function parseWodalProgramImage(input: string | Uint8Array): WodalProgramImageParseResult {
  if (typeof input === "string") {
    return parseWodalProgramImageJson(input);
  }

  const encoding = detectMindcraftProgramImageEncoding(input);
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

  if (encoding === MindcraftProgramImageEncoding.BINARY) {
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
 * Validates a parsed JSON program image envelope for WODAL.
 *
 * @param value - Parsed JSON value from a program image.
 */
export function validateWodalProgramImage(value: unknown): WodalProgramImageParseResult {
  return validateMindcraftResultForWodal(validateMindcraftProgramImage(value), value);
}

/**
 * Serializes a WODAL program image envelope as JSON text.
 *
 * @param image - Program image envelope to serialize.
 */
export function serializeWodalProgramImageJson<TProgram>(image: WodalProgramImage<TProgram>): string {
  return serializeMindcraftProgramImageJson(image);
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
      encoding: MindcraftProgramImageEncoding.JSON,
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

function validateMindcraftResultForWodal<TProgram>(
  result: MindcraftProgramImageParseResult<TProgram>,
  source?: unknown
): WodalProgramImageParseResult<TProgram> {
  if (!result.ok) {
    const unsupportedProfileError =
      source === undefined ? undefined : readUnsupportedWodalProfileError(source, result.encoding);
    const errors = result.errors.map(toWodalProgramImageValidationError);
    return {
      ...result,
      errors: insertUnsupportedProfileError(errors, unsupportedProfileError),
    };
  }

  if (!isWodalDeviceProfileId(result.image.profileId)) {
    return {
      ok: false,
      encoding: result.encoding,
      errors: [
        {
          code: WodalProgramImageValidationCode.UNSUPPORTED_PROGRAM_IMAGE_PROFILE,
          path: "$.profileId",
          message: "Program image profileId is not supported by WODAL.",
        },
      ],
    };
  }

  return {
    ok: true,
    encoding: result.encoding,
    image: result.image as WodalProgramImage<TProgram>,
    errors: [],
  };
}

function insertUnsupportedProfileError(
  errors: readonly WodalProgramImageValidationError[],
  unsupportedProfileError: WodalProgramImageValidationError | undefined
): readonly WodalProgramImageValidationError[] {
  if (unsupportedProfileError === undefined) {
    return errors;
  }
  const missingProgramIndex = errors.findIndex(
    (error) => error.code === WodalProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM
  );
  if (missingProgramIndex === -1) {
    return [...errors, unsupportedProfileError];
  }
  return [...errors.slice(0, missingProgramIndex), unsupportedProfileError, ...errors.slice(missingProgramIndex)];
}

function readUnsupportedWodalProfileError(
  value: unknown,
  encoding?: MindcraftProgramImageEncoding
): WodalProgramImageValidationError | undefined {
  if (encoding !== MindcraftProgramImageEncoding.JSON || !isRecord(value)) {
    return undefined;
  }
  const profileId = value.profileId;
  if (typeof profileId !== "string" || isWodalDeviceProfileId(profileId)) {
    return undefined;
  }
  return {
    code: WodalProgramImageValidationCode.UNSUPPORTED_PROGRAM_IMAGE_PROFILE,
    path: "$.profileId",
    message: "Program image profileId is not supported by WODAL.",
  };
}

function toWodalProgramImageValidationError(
  error: MindcraftProgramImageValidationError
): WodalProgramImageValidationError {
  return {
    code: error.code,
    path: error.path,
    message: error.message,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
