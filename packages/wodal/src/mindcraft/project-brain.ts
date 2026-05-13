import {
  type MindcraftProjectBrainSelectionResult,
  type MindcraftProjectBrainSelector,
  selectMindcraftProjectBrain,
} from "@mindcraft-lang/service-api";
import type { WodalProjectDocument } from "./project-document";

export {
  MindcraftProjectBrainSelectionCode,
  type MindcraftProjectBrainSelectionError,
  type MindcraftProjectBrainSelectionResult,
  type MindcraftProjectBrainSelector,
  type MindcraftProjectSelectedBrain,
} from "@mindcraft-lang/service-api";

/**
 * Selects a serialized brain from a WODAL-validated project document.
 *
 * @param document - Project document returned by WODAL validation or parsing.
 * @param selector - Brain selector. Omit only when the project contains one brain.
 */
export function selectWodalProjectBrain(
  document: WodalProjectDocument,
  selector?: MindcraftProjectBrainSelector
): MindcraftProjectBrainSelectionResult {
  return selectMindcraftProjectBrain(document, selector);
}
