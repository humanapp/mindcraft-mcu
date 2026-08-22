import type { IBrainDef, WendooEnvironment } from "@wendoo-lang/core/app";
import type { LinkedBrainProgram } from "@wendoo-lang/core/runtime";
import type { WodalDeviceProfile, WodalDeviceProfileId } from "./device-profile";
import type { WodalProgramImage } from "./program-image";

/**
 * Live inputs the WODAL build kernel links into a device program image.
 *
 * These are live objects, not a serialized document: the selected brain
 * definition and the caller-owned Wendoo environment that already has the
 * profile's modules (and therefore its host tiles) installed. This is the one
 * canonical build-input shape; callers do not define a parallel type.
 */
export interface WodalBuildInput {
  /** Selected live brain definition to build. */
  readonly brainDef: IBrainDef;

  /** Caller-owned environment whose installed modules match the device profile. */
  readonly environment: WendooEnvironment;

  /** Resolved device profile that creates the program image. */
  readonly deviceProfile: WodalDeviceProfile;
}

/** Stable diagnostic code for a failed WODAL brain build. */
export const WodalBuildDiagnosticCode = {
  /** The brain failed to compile or link. */
  BRAIN_LINK_FAILED: "WODAL_BUILD_BRAIN_LINK_FAILED",

  /** The device profile failed to create a program image from the linked brain. */
  PROGRAM_IMAGE_CREATION_FAILED: "WODAL_BUILD_PROGRAM_IMAGE_CREATION_FAILED",
} as const;

/** Union of all {@link WodalBuildDiagnosticCode} values. */
export type WodalBuildDiagnosticCode = (typeof WodalBuildDiagnosticCode)[keyof typeof WodalBuildDiagnosticCode];

/** Diagnostic for a rejected WODAL brain build. */
export interface WodalBuildDiagnostic {
  /** Stable machine-readable build code. */
  readonly code: WodalBuildDiagnosticCode;

  /** Human-readable diagnostic message. */
  readonly message: string;

  /** Original thrown value that caused the failure. */
  readonly cause?: unknown;
}

/** Result of building a live brain definition into a WODAL program image. */
export type WodalBuildResult =
  | {
      /** True when the brain linked and a program image was created. */
      readonly ok: true;

      /** Device profile id embedded in the program image. */
      readonly profileId: WodalDeviceProfileId;

      /** Program image flashable onto a simulator or device for the profile. */
      readonly image: WodalProgramImage<LinkedBrainProgram>;

      /** Empty diagnostics list for a successful build. */
      readonly errors: readonly [];
    }
  | {
      /** False when brain linking or image creation failed. */
      readonly ok: false;

      /** Build diagnostics for the rejected brain. */
      readonly errors: readonly [WodalBuildDiagnostic, ...WodalBuildDiagnostic[]];
    };

/**
 * Builds a WODAL program image from a live brain definition using the supplied
 * device profile.
 *
 * @param input - Selected brain definition, caller-owned environment, and resolved device profile.
 */
export function buildWodalProgramImage(input: WodalBuildInput): WodalBuildResult {
  let built: ReturnType<WendooEnvironment["linkBrain"]>;
  try {
    built = input.environment.linkBrain(input.brainDef);
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          code: WodalBuildDiagnosticCode.BRAIN_LINK_FAILED,
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        },
      ],
    };
  }
  if (!built.program) {
    const message = built.diagnostics
      .toArray()
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.message)
      .join("; ");
    return { ok: false, errors: [{ code: WodalBuildDiagnosticCode.BRAIN_LINK_FAILED, message }] };
  }

  try {
    const image = input.deviceProfile.createProgramImage(built.program);
    return { ok: true, profileId: input.deviceProfile.profileId, image, errors: [] };
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          code: WodalBuildDiagnosticCode.PROGRAM_IMAGE_CREATION_FAILED,
          message: `Failed to create a program image for profile '${input.deviceProfile.profileId}'.`,
          cause,
        },
      ],
    };
  }
}
