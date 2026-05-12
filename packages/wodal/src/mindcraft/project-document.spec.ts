import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getWodalProjectTarget,
  MINDCRAFT_PROJECT_FORMAT,
  parseWodalProjectDocument,
  validateWodalProjectDocument,
  WODAL_MICROBIT_V2_PROFILE,
  WODAL_PROJECT_TARGET_KEY,
  type WodalProjectDocument,
  WodalProjectValidationCode,
} from "./project-document";

type ProjectValidationCode = (typeof WodalProjectValidationCode)[keyof typeof WodalProjectValidationCode];

const VALID_DOCUMENT = {
  format: MINDCRAFT_PROJECT_FORMAT,
  name: "Blink",
  description: "A blinking LED project",
  files: [
    {
      path: "src/main.ts",
      content: "context.microbit.display.setPixelValue(0, 0, 255);",
    },
  ],
  brains: {
    blink: { rules: [] },
    button: { rules: [] },
  },
  targets: {
    [WODAL_PROJECT_TARGET_KEY]: {
      packageVersion: "0.2.1",
      profile: WODAL_MICROBIT_V2_PROFILE,
    },
    "@mindcraft-lang/microbit-sim": {
      packageVersion: "0.1.0",
    },
  },
} satisfies WodalProjectDocument;

function errorCodes(value: unknown): readonly ProjectValidationCode[] {
  const result = validateWodalProjectDocument(value);
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

describe("parseWodalProjectDocument", () => {
  it("parses the shared Mindcraft project shape used by WODAL", () => {
    const result = parseWodalProjectDocument(JSON.stringify(VALID_DOCUMENT));

    assert.equal(result.ok, true);
    assert.deepEqual(result.document, VALID_DOCUMENT);
    assert.equal(getWodalProjectTarget(result.document).profile, "microbit-v2");
    assert.deepEqual(Object.keys(result.document.brains).sort(), ["blink", "button"]);
  });

  it("returns a stable code for malformed JSON", () => {
    const result = parseWodalProjectDocument("{not json");

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WodalProjectValidationCode.INVALID_JSON]
    );
  });
});

describe("validateWodalProjectDocument", () => {
  it("ignores legacy host and app fields when the shared target shape is present", () => {
    const result = validateWodalProjectDocument({
      ...VALID_DOCUMENT,
      host: { name: "legacy", version: "1.0.0" },
      app: { state: true },
    });

    assert.equal(result.ok, true);
    assert.equal(getWodalProjectTarget(result.document).profile, WODAL_MICROBIT_V2_PROFILE);
  });

  it("preserves unknown target entries for callers that rewrite documents", () => {
    const result = validateWodalProjectDocument(VALID_DOCUMENT);

    assert.equal(result.ok, true);
    assert.deepEqual(result.document.targets["@mindcraft-lang/microbit-sim"], {
      packageVersion: "0.1.0",
    });
  });

  it("rejects legacy exports that do not use format and targets", () => {
    assert.deepEqual(
      errorCodes({
        host: { name: "sim", version: "1.0.0" },
        name: "Legacy",
        description: "",
        files: [],
        brains: {},
        app: {},
      }),
      [WodalProjectValidationCode.INVALID_FORMAT, WodalProjectValidationCode.INVALID_TARGETS]
    );
  });

  it("requires the WODAL target entry", () => {
    assert.deepEqual(errorCodes({ ...VALID_DOCUMENT, targets: {} }), [WodalProjectValidationCode.MISSING_WODAL_TARGET]);
  });

  it("rejects unsupported WODAL profiles", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_DOCUMENT,
        targets: {
          [WODAL_PROJECT_TARGET_KEY]: {
            packageVersion: "0.2.1",
            profile: "microbit-v1",
          },
        },
      }),
      [WodalProjectValidationCode.UNSUPPORTED_WODAL_PROFILE]
    );
  });

  it("rejects brain selection in the WODAL target", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_DOCUMENT,
        targets: {
          [WODAL_PROJECT_TARGET_KEY]: {
            packageVersion: "0.2.1",
            profile: WODAL_MICROBIT_V2_PROFILE,
            brainId: "blink",
          },
        },
      }),
      [WodalProjectValidationCode.UNEXPECTED_WODAL_BRAIN_ID]
    );
  });

  it("rejects invalid file entries with stable codes", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_DOCUMENT,
        files: [
          { path: "../outside.ts", content: "" },
          { path: "src/main.ts", content: 42 },
        ],
      }),
      [WodalProjectValidationCode.INVALID_FILE_PATH, WodalProjectValidationCode.INVALID_FILE_CONTENT]
    );
  });

  it("rejects invalid common object fields with stable codes", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_DOCUMENT,
        brains: [],
        targets: [],
      }),
      [WodalProjectValidationCode.INVALID_BRAINS, WodalProjectValidationCode.INVALID_TARGETS]
    );
  });
});
