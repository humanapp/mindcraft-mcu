import {
  MINDCRAFT_PROJECT_FORMAT,
  type MindcraftProjectDocument,
  MindcraftProjectDocumentValidationCode,
  type MindcraftProjectTargets,
  parseMindcraftProjectDocument,
  validateMindcraftProjectDocument,
} from "@mindcraft-lang/service-api";
import { name as wodalPackageName, version as wodalPackageVersion } from "../../package.json";
import { isWodalDeviceProfileId, WODAL_DEVICE_PROFILE_IDS, type WodalDeviceProfileId } from "./device-profile";

export { MINDCRAFT_PROJECT_FORMAT };

/** Target key used for WODAL-owned project metadata. */
export const WODAL_PROJECT_TARGET_KEY = wodalPackageName;

/** Validation code constants used by WODAL project document diagnostics. */
export const WodalProjectValidationCode = {
  ...MindcraftProjectDocumentValidationCode,
  MISSING_WODAL_TARGET: "WODAL_PROJECT_MISSING_WODAL_TARGET",
  INVALID_WODAL_TARGET: "WODAL_PROJECT_INVALID_WODAL_TARGET",
  INVALID_WODAL_PACKAGE_VERSION: "WODAL_PROJECT_INVALID_WODAL_PACKAGE_VERSION",
  UNSUPPORTED_WODAL_PROFILE: "WODAL_PROJECT_UNSUPPORTED_WODAL_PROFILE",
  UNEXPECTED_WODAL_BRAIN_ID: "WODAL_PROJECT_UNEXPECTED_WODAL_BRAIN_ID",
} as const;

/** Union of all {@link WodalProjectValidationCode} values. */
export type WodalProjectValidationCode = (typeof WodalProjectValidationCode)[keyof typeof WodalProjectValidationCode];

/** WODAL-owned target metadata inside a shared Mindcraft project document. */
export interface WodalProjectTarget {
  /** Version of the WODAL package that wrote or upgraded this target metadata. */
  readonly packageVersion: string;

  /** Device profile used for WODAL build and deploy commands. */
  readonly profile: WodalDeviceProfileId;
}

/** Validation diagnostic for a rejected project document. */
export interface WodalProjectValidationError {
  /** Stable machine-readable validation code. */
  readonly code: WodalProjectValidationCode;

  /** JSON path of the rejected field. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;
}

/** Result of validating or parsing a WODAL project document. */
export type WodalProjectParseResult =
  | {
      /** True when a valid WODAL project document was produced. */
      readonly ok: true;

      /** Parsed shared project document with WODAL target metadata. */
      readonly document: MindcraftProjectDocument;

      /** Empty diagnostics list for a valid document. */
      readonly errors: readonly [];
    }
  | {
      /** False when validation rejected the document. */
      readonly ok: false;

      /** Validation diagnostics. */
      readonly errors: readonly WodalProjectValidationError[];
    };

/** Result of validating the WODAL target within a shared document's `targets` map. */
export type WodalTargetParseResult =
  | {
      /** True when a valid WODAL target was found. */
      readonly ok: true;

      /** Parsed WODAL target metadata. */
      readonly target: WodalProjectTarget;

      /** Empty diagnostics list for a valid target. */
      readonly errors: readonly [];
    }
  | {
      /** False when the WODAL target is missing or invalid. */
      readonly ok: false;

      /** Validation diagnostics. */
      readonly errors: readonly WodalProjectValidationError[];
    };

/**
 * Parses and validates a shared Mindcraft project document for WODAL.
 *
 * @param content - JSON text from a `.mindcraft` file.
 */
export function parseWodalProjectDocument(content: string): WodalProjectParseResult {
  const parsed = parseMindcraftProjectDocument(content);
  if (!parsed.ok) {
    return parsed;
  }

  return validateWodalTargetInDocument(parsed.document);
}

/**
 * Validates a parsed shared Mindcraft project document for WODAL.
 *
 * @param value - Parsed JSON value from a `.mindcraft` file.
 */
export function validateWodalProjectDocument(value: unknown): WodalProjectParseResult {
  const parsed = validateMindcraftProjectDocument(value);
  if (!parsed.ok) {
    return parsed;
  }

  return validateWodalTargetInDocument(parsed.document);
}

/**
 * Returns WODAL target metadata from a WODAL-validated project document.
 *
 * @param document - Project document returned by WODAL validation or parsing.
 */
export function getWodalProjectTarget(document: MindcraftProjectDocument): WodalProjectTarget {
  return document.targets[WODAL_PROJECT_TARGET_KEY] as WodalProjectTarget;
}

/**
 * Validates the WODAL target inside a shared document's `targets` map and returns the parsed target.
 *
 * @param targets - The shared document's `targets` map.
 */
export function validateWodalTarget(targets: MindcraftProjectTargets): WodalTargetParseResult {
  if (!(WODAL_PROJECT_TARGET_KEY in targets)) {
    return {
      ok: false,
      errors: [
        {
          code: WodalProjectValidationCode.MISSING_WODAL_TARGET,
          path: `$.targets["${WODAL_PROJECT_TARGET_KEY}"]`,
          message: "Project document is missing the WODAL target.",
        },
      ],
    };
  }

  const errors: WodalProjectValidationError[] = [];
  const target = readWodalTarget(targets[WODAL_PROJECT_TARGET_KEY], errors);
  if (target === undefined || errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, target, errors: [] };
}

/**
 * Builds WODAL target metadata for a device profile, stamping the current WODAL package version.
 *
 * @param profile - Device profile the project targets.
 */
export function buildWodalProjectTarget(profile: WodalDeviceProfileId): WodalProjectTarget {
  return { packageVersion: wodalPackageVersion, profile };
}

function validateWodalTargetInDocument(document: MindcraftProjectDocument): WodalProjectParseResult {
  const result = validateWodalTarget(document.targets);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return {
    ok: true,
    document: {
      ...document,
      targets: { ...document.targets, [WODAL_PROJECT_TARGET_KEY]: result.target },
    },
    errors: [],
  };
}

function readWodalTarget(value: unknown, errors: WodalProjectValidationError[]): WodalProjectTarget | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    errors.push({
      code: WodalProjectValidationCode.INVALID_WODAL_TARGET,
      path: `$.targets["${WODAL_PROJECT_TARGET_KEY}"]`,
      message: "WODAL target must be an object.",
    });
    return undefined;
  }

  const packageVersion = readString(
    value,
    "packageVersion",
    `$.targets["${WODAL_PROJECT_TARGET_KEY}"].packageVersion`,
    WodalProjectValidationCode.INVALID_WODAL_PACKAGE_VERSION,
    errors
  );
  const profile = readString(
    value,
    "profile",
    `$.targets["${WODAL_PROJECT_TARGET_KEY}"].profile`,
    WodalProjectValidationCode.UNSUPPORTED_WODAL_PROFILE,
    errors
  );

  if ("brainId" in value) {
    errors.push({
      code: WodalProjectValidationCode.UNEXPECTED_WODAL_BRAIN_ID,
      path: `$.targets["${WODAL_PROJECT_TARGET_KEY}"].brainId`,
      message: "WODAL target must not contain a brainId field.",
    });
  }

  if (profile !== undefined && !isWodalDeviceProfileId(profile)) {
    errors.push({
      code: WodalProjectValidationCode.UNSUPPORTED_WODAL_PROFILE,
      path: `$.targets["${WODAL_PROJECT_TARGET_KEY}"].profile`,
      message: `WODAL target profile must be one of: ${WODAL_DEVICE_PROFILE_IDS.join(", ")}.`,
    });
  }

  if (packageVersion === undefined || profile === undefined || !isWodalDeviceProfileId(profile)) {
    return undefined;
  }

  return {
    packageVersion,
    profile,
  };
}

function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  code: WodalProjectValidationCode,
  errors: WodalProjectValidationError[]
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
