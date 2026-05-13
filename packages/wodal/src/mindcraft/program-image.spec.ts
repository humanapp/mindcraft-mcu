import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC,
  MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  MINDCRAFT_PROGRAM_IMAGE_VERSION,
  MindcraftProgramImageEncoding,
} from "@mindcraft-lang/service-api";
import { WodalDeviceProfileId } from "./device-profile";
import {
  parseWodalProgramImage,
  serializeWodalProgramImageJson,
  validateWodalProgramImage,
  type WodalProgramImage,
  WodalProgramImageValidationCode,
} from "./program-image";

type ProgramImageValidationCode =
  (typeof WodalProgramImageValidationCode)[keyof typeof WodalProgramImageValidationCode];

const VALID_IMAGE: WodalProgramImage<{
  readonly entry: string;
  readonly bytecode: readonly number[];
}> = {
  format: MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  version: MINDCRAFT_PROGRAM_IMAGE_VERSION,
  profileId: WodalDeviceProfileId.MICROBIT_V2,
  program: {
    entry: "main",
    bytecode: [1, 2, 3],
  },
};

function errorCodes(value: unknown): readonly ProgramImageValidationCode[] {
  const result = validateWodalProgramImage(value);
  assert.equal(result.ok, false);
  return result.errors.map((error) => error.code);
}

describe("parseWodalProgramImage", () => {
  it("parses JSON program image text", () => {
    const result = parseWodalProgramImage(JSON.stringify(VALID_IMAGE));

    assert.equal(result.ok, true);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.JSON);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("detects JSON program image bytes", () => {
    const bytes = new TextEncoder().encode(`\n${JSON.stringify(VALID_IMAGE)}`);
    const result = parseWodalProgramImage(bytes);

    assert.equal(result.ok, true);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.JSON);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("returns a stable code for malformed JSON", () => {
    const result = parseWodalProgramImage("{not json");

    assert.equal(result.ok, false);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.JSON);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_JSON]
    );
    assert.ok(result.errors[0]?.cause);
  });

  it("returns a stable code for recognized binary program images", () => {
    const result = parseWodalProgramImage(new Uint8Array([...MINDCRAFT_BINARY_PROGRAM_IMAGE_MAGIC, 1, 2, 3]));

    assert.equal(result.ok, false);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.BINARY);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WodalProgramImageValidationCode.UNSUPPORTED_BINARY_PROGRAM_IMAGE]
    );
  });

  it("returns a stable code for unknown byte encodings", () => {
    const result = parseWodalProgramImage(new Uint8Array([0x01, 0x02, 0x03]));

    assert.equal(result.ok, false);
    assert.equal(result.encoding, undefined);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      [WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ENCODING]
    );
  });
});

describe("validateWodalProgramImage", () => {
  it("validates a parsed program image object", () => {
    const result = validateWodalProgramImage(VALID_IMAGE);

    assert.equal(result.ok, true);
    assert.deepEqual(result.image, VALID_IMAGE);
  });

  it("rejects invalid common envelope fields with stable codes", () => {
    assert.deepEqual(
      errorCodes({
        ...VALID_IMAGE,
        format: "mindcraft.project",
        version: 2,
        profileId: "microbit-v1",
        program: null,
      }),
      [
        WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_FORMAT,
        WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_VERSION,
        WodalProgramImageValidationCode.UNSUPPORTED_PROGRAM_IMAGE_PROFILE,
        WodalProgramImageValidationCode.MISSING_PROGRAM_IMAGE_PROGRAM,
      ]
    );
  });

  it("rejects non-object JSON roots", () => {
    assert.deepEqual(errorCodes([]), [WodalProgramImageValidationCode.INVALID_PROGRAM_IMAGE_ROOT]);
  });
});

describe("serializeWodalProgramImageJson", () => {
  it("preserves the embedded profile id across JSON serialization", () => {
    const serialized = serializeWodalProgramImageJson(VALID_IMAGE);
    const result = parseWodalProgramImage(serialized);

    assert.equal(result.ok, true);
    assert.equal(result.image.profileId, WodalDeviceProfileId.MICROBIT_V2);
    assert.deepEqual(result.image, VALID_IMAGE);
  });
});
