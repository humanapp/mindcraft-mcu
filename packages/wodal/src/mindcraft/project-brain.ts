import type { IBrainDef, MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  type MindcraftProjectBrainSelectionCode,
  type MindcraftProjectBrainSelectionResult,
  type MindcraftProjectBrainSelector,
  type MindcraftProjectDocument,
  type MindcraftProjectSelectedBrain,
  selectMindcraftProjectBrain,
} from "@mindcraft-lang/service-api";

export {
  MindcraftProjectBrainSelectionCode,
  type MindcraftProjectBrainSelectionError,
  type MindcraftProjectBrainSelectionResult,
  type MindcraftProjectBrainSelector,
  type MindcraftProjectSelectedBrain,
} from "@mindcraft-lang/service-api";

/** Validation code constants used by WODAL project brain hydration diagnostics. */
export const WodalProjectBrainHydrationCode = {
  INVALID_BRAIN_DOCUMENT: "WODAL_PROJECT_BRAIN_INVALID_DOCUMENT",
} as const;

/** Union of all {@link WodalProjectBrainHydrationCode} values. */
export type WodalProjectBrainHydrationCode =
  (typeof WodalProjectBrainHydrationCode)[keyof typeof WodalProjectBrainHydrationCode];

/** Code emitted while selecting or hydrating a WODAL project brain. */
export type WodalProjectBrainHydrationErrorCode = MindcraftProjectBrainSelectionCode | WodalProjectBrainHydrationCode;

/** Caller-owned inputs for WODAL project brain hydration. */
export interface HydrateWodalProjectBrainOptions {
  /** Project document returned by WODAL validation or parsing. */
  readonly document: MindcraftProjectDocument;

  /** Mindcraft environment whose installed modules match the document target profile. */
  readonly environment: MindcraftEnvironment;

  /** Brain selector. Omit only when the project contains one brain. */
  readonly selector?: MindcraftProjectBrainSelector;
}

/** Diagnostic emitted while selecting or hydrating a WODAL project brain. */
export interface WodalProjectBrainHydrationError {
  /** Stable machine-readable selection or hydration code. */
  readonly code: WodalProjectBrainHydrationErrorCode;

  /** JSON path of the rejected field. */
  readonly path: string;

  /** Human-readable diagnostic message. */
  readonly message: string;

  /** Original thrown value when hydration fails inside the Mindcraft environment. */
  readonly cause?: unknown;
}

/** Result of hydrating a selected brain from a WODAL project document. */
export type WodalProjectBrainHydrationResult =
  | {
      /** True when the selected brain was hydrated. */
      readonly ok: true;

      /** Project document brain id selected for hydration. */
      readonly brainId: string;

      /** Brain definition deserialized by the caller-provided Mindcraft environment. */
      readonly brainDef: IBrainDef;

      /** Empty diagnostics list for a valid hydration. */
      readonly errors: readonly [];
    }
  | {
      /** False when selection or hydration failed. */
      readonly ok: false;

      /** Selection or hydration diagnostics. */
      readonly errors: readonly WodalProjectBrainHydrationError[];
    };

/**
 * Selects a serialized brain from a WODAL-validated project document.
 *
 * @param document - Project document returned by WODAL validation or parsing.
 * @param selector - Brain selector. Omit only when the project contains one brain.
 */
export function selectWodalProjectBrain(
  document: MindcraftProjectDocument,
  selector?: MindcraftProjectBrainSelector
): MindcraftProjectBrainSelectionResult {
  return selectMindcraftProjectBrain(document, selector);
}

/**
 * Selects and hydrates a serialized brain from a WODAL project document.
 *
 * @param options - Project document, caller-owned environment, and optional selector.
 */
export function hydrateWodalProjectBrain(options: HydrateWodalProjectBrainOptions): WodalProjectBrainHydrationResult {
  const selected = selectWodalProjectBrain(options.document, options.selector);
  if (!selected.ok) {
    return selected;
  }

  try {
    return {
      ok: true,
      brainId: selected.brain.id,
      brainDef: options.environment.deserializeBrainJsonFromPlain(selected.brain.document),
      errors: [],
    };
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          code: WodalProjectBrainHydrationCode.INVALID_BRAIN_DOCUMENT,
          path: `$.brains[${JSON.stringify(selected.brain.id)}]`,
          message: "Selected brain document could not be deserialized by the Mindcraft environment.",
          cause,
        },
      ],
    };
  }
}
