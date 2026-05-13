import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "./device-profile";
import {
  hydrateWodalProjectBrain,
  MindcraftProjectBrainSelectionCode,
  type MindcraftProjectBrainSelectionResult,
  selectWodalProjectBrain,
  WodalProjectBrainHydrationCode,
  type WodalProjectBrainHydrationResult,
} from "./project-brain";
import {
  MINDCRAFT_PROJECT_FORMAT,
  parseWodalProjectDocument,
  WODAL_PROJECT_TARGET_KEY,
  type WodalProjectDocument,
} from "./project-document";

type BrainSelectionCode = (typeof MindcraftProjectBrainSelectionCode)[keyof typeof MindcraftProjectBrainSelectionCode];
type BrainHydrationCode =
  | BrainSelectionCode
  | (typeof WodalProjectBrainHydrationCode)[keyof typeof WodalProjectBrainHydrationCode];

const VALID_BRAIN = {
  version: 1,
  name: "Blink",
  catalog: [],
  pages: [],
};

const VALID_DOCUMENT = {
  format: MINDCRAFT_PROJECT_FORMAT,
  name: "Blink",
  description: "A blinking LED project",
  files: [],
  brains: {
    blink: VALID_BRAIN,
    button: { version: 1, name: "Button", catalog: [], pages: [] },
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

function hydrationCodes(result: WodalProjectBrainHydrationResult): readonly BrainHydrationCode[] {
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

function createMicroBitV2Environment() {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  return createMindcraftEnvironment({ modules: [coreModule(), profile.createMindcraftModule()] });
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

describe("hydrateWodalProjectBrain", () => {
  it("hydrates a selected brain with a caller-owned profile environment", () => {
    const environment = createMicroBitV2Environment();

    const result = hydrateWodalProjectBrain({
      document: VALID_DOCUMENT,
      environment,
      selector: { kind: "id", id: "blink" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.brainId, "blink");
    assert.equal(result.brainDef.name(), "Blink");
    assert.equal(result.brainDef.pages().size(), 0);
  });

  it("preserves shared selection failures", () => {
    const result = hydrateWodalProjectBrain({
      document: VALID_DOCUMENT,
      environment: createMicroBitV2Environment(),
    });

    assert.deepEqual(hydrationCodes(result), [MindcraftProjectBrainSelectionCode.MISSING_BRAIN_SELECTOR]);
  });

  it("returns a stable code when the selected brain cannot be hydrated", () => {
    const result = hydrateWodalProjectBrain({
      document: {
        ...VALID_DOCUMENT,
        brains: {
          broken: { version: 2, name: "Broken", catalog: [], pages: [] },
        },
      },
      environment: createMicroBitV2Environment(),
      selector: { kind: "id", id: "broken" },
    });

    assert.deepEqual(hydrationCodes(result), [WodalProjectBrainHydrationCode.INVALID_BRAIN_DOCUMENT]);
    assert.equal(result.ok, false);
    assert.ok(result.errors[0]?.cause);
  });
});
