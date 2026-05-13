import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateWodalBytecodeImage, WodalBytecodeValidationCode } from "./bytecode-loader";

describe("validateWodalBytecodeImage", () => {
  it("accepts a valid image envelope", () => {
    assert.deepEqual(validateWodalBytecodeImage({ version: 1, program: { functions: [] } }), {
      ok: true,
      errors: [],
    });
  });

  it("rejects invalid image envelopes with stable codes", () => {
    const validation = validateWodalBytecodeImage({ version: 65536, program: null });

    assert.equal(validation.ok, false);
    assert.deepEqual(
      validation.errors.map((error) => error.code),
      [WodalBytecodeValidationCode.INVALID_BYTECODE_VERSION, WodalBytecodeValidationCode.MISSING_BYTECODE_PROGRAM]
    );
    assert.deepEqual(
      validation.errors.map((error) => error.message),
      ["Invalid bytecode version.", "Missing bytecode program."]
    );
  });
});
