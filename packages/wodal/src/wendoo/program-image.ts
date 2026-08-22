import {
  detectWendooProgramImageEncoding,
  parseWendooProgramImage,
  serializeWendooProgramImageJson,
  validateWendooProgramImage,
  type WendooProgramImage,
  WendooProgramImageEncoding,
  type WendooProgramImageParseResult,
  WendooProgramImageValidationCode,
  type WendooProgramImageValidationError,
} from "@wendoo-lang/service-api";
import { isWodalDeviceProfileId, type WodalDeviceProfileId } from "./device-profile-id";

/** Validation code constants used by WODAL program image diagnostics. */
export const WodalProgramImageValidationCode = {
  ...WendooProgramImageValidationCode,
  UNSUPPORTED_PROGRAM_IMAGE_PROFILE: "WODAL_PROGRAM_IMAGE_UNSUPPORTED_PROFILE",
} as const;

/** Union of all {@link WodalProgramImageValidationCode} values. */
export type WodalProgramImageValidationCode =
  (typeof WodalProgramImageValidationCode)[keyof typeof WodalProgramImageValidationCode];

/** Serialized Wendoo program image envelope accepted by WODAL. */
export type WodalProgramImage<TProgram = unknown> = WendooProgramImage<TProgram, WodalDeviceProfileId>;

/** Validation diagnostic for a rejected WODAL program image. */
export type WodalProgramImageValidationError = WendooProgramImageValidationError<WodalProgramImageValidationCode>;

/** Result of validating or parsing a WODAL program image. */
export type WodalProgramImageParseResult<TProgram = unknown> = WendooProgramImageParseResult<
  TProgram,
  WodalDeviceProfileId,
  WodalProgramImageValidationError
>;

/**
 * Parses a `.mcprogram` image from JSON text or bytes and validates it for WODAL.
 *
 * @param input - Program image contents.
 */
export function parseWodalProgramImage(input: string | Uint8Array): WodalProgramImageParseResult {
  return validateWendooResultForWodal(parseWendooProgramImage(input), readProgramImageProfileSource(input));
}

/**
 * Validates a parsed JSON program image envelope for WODAL.
 *
 * @param value - Parsed JSON value from a program image.
 */
export function validateWodalProgramImage(value: unknown): WodalProgramImageParseResult {
  return validateWendooResultForWodal(validateWendooProgramImage(value), value);
}

/**
 * Serializes a WODAL program image envelope as JSON text.
 *
 * @param image - Program image envelope to serialize.
 */
export function serializeWodalProgramImageJson<TProgram>(image: WodalProgramImage<TProgram>): string {
  return serializeWendooProgramImageJson(image);
}

function readProgramImageProfileSource(input: string | Uint8Array): unknown {
  let content: string;
  if (typeof input === "string") {
    content = input;
  } else if (detectWendooProgramImageEncoding(input) === WendooProgramImageEncoding.JSON) {
    content = new TextDecoder().decode(input);
  } else {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  return parsed;
}

function validateWendooResultForWodal<TProgram>(
  result: WendooProgramImageParseResult<TProgram>,
  source?: unknown
): WodalProgramImageParseResult<TProgram> {
  if (!result.ok) {
    const unsupportedProfileError =
      source === undefined ? undefined : readUnsupportedWodalProfileError(source, result.encoding);
    return {
      ...result,
      errors: insertUnsupportedProfileError(result.errors, unsupportedProfileError),
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
  encoding?: WendooProgramImageEncoding
): WodalProgramImageValidationError | undefined {
  if (encoding !== WendooProgramImageEncoding.JSON || !isRecord(value)) {
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
