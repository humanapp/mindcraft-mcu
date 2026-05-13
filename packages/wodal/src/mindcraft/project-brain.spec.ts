import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WodalDeviceProfileId } from "./device-profile";
import {
  MindcraftProjectBrainSelectionCode,
  type MindcraftProjectBrainSelectionResult,
  selectWodalProjectBrain,
} from "./project-brain";
import {
  MINDCRAFT_PROJECT_FORMAT,
  parseWodalProjectDocument,
  WODAL_PROJECT_TARGET_KEY,
  type WodalProjectDocument,
} from "./project-document";

type BrainSelectionCode = (typeof MindcraftProjectBrainSelectionCode)[keyof typeof MindcraftProjectBrainSelectionCode];

const VALID_DOCUMENT = {
  format: MINDCRAFT_PROJECT_FORMAT,
  name: "Blink",
  description: "A blinking LED project",
  files: [],
  brains: {
    blink: { version: 1, name: "Blink", pages: [] },
    button: { version: 1, name: "Button", pages: [] },
  },
  targets: {
    [WODAL_PROJECT_TARGET_KEY]: {
      packageVersion: "0.2.1",
      profile: WodalDeviceProfileId.MICROBIT_V2,
    },
  },
} satisfies WodalProjectDocument;

function selectionCodes(result: MindcraftProjectBrainSelectionResult): readonly BrainSelectionCode[] {
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

describe("selectWodalProjectBrain", () => {
  it("selects a brain from a parsed WODAL project document by id", () => {
    const parsed = parseWodalProjectDocument(JSON.stringify(VALID_DOCUMENT));
    assert.equal(parsed.ok, true);

    const result = selectWodalProjectBrain(parsed.document, { kind: "id", id: "blink" });

    assert.equal(result.ok, true);
    assert.equal(result.brain.id, "blink");
    assert.equal(result.brain.name, "Blink");
    assert.deepEqual(result.brain.document, VALID_DOCUMENT.brains.blink);
  });

  it("selects a brain by display name without reading WODAL target metadata", () => {
    const result = selectWodalProjectBrain(VALID_DOCUMENT, { kind: "name", name: "Button" });

    assert.equal(result.ok, true);
    assert.equal(result.brain.id, "button");
    assert.equal(result.brain.name, "Button");
  });

  it("preserves shared stable selection codes", () => {
    assert.deepEqual(selectionCodes(selectWodalProjectBrain(VALID_DOCUMENT)), [
      MindcraftProjectBrainSelectionCode.MISSING_BRAIN_SELECTOR,
    ]);
    assert.deepEqual(selectionCodes(selectWodalProjectBrain(VALID_DOCUMENT, { kind: "id", id: "missing" })), [
      MindcraftProjectBrainSelectionCode.BRAIN_NOT_FOUND,
    ]);
  });
});
