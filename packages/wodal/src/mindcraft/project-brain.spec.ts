import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MindcraftProjectBrainSelectionCode, type MindcraftProjectDocument } from "@mindcraft-lang/service-api";
import { createMicroBitV2Environment } from "../targets/microbit-v2/mindcraft/environment";
import { WodalDeviceProfileId } from "./device-profile";
import {
  hydrateWodalProjectBrain,
  WodalProjectBrainHydrationCode,
  type WodalProjectBrainHydrationResult,
} from "./project-brain";
import { MINDCRAFT_PROJECT_FORMAT, WODAL_PROJECT_TARGET_KEY } from "./project-document";

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
  version: "1.0.0",
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
} satisfies MindcraftProjectDocument;

function hydrationCodes(result: WodalProjectBrainHydrationResult): readonly BrainHydrationCode[] {
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

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
