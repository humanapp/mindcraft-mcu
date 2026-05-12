import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WodalBytecodeLoader } from "./bytecode-loader";

describe("WodalBytecodeLoader", () => {
  it("accepts a valid image envelope", () => {
    const loader = new WodalBytecodeLoader();
    const image = { version: 1, program: { functions: [] } };

    assert.deepEqual(loader.load(image), { ok: true, errors: [] });
    assert.equal(loader.getActiveImage(), image);
  });

  it("rejects invalid image envelopes without replacing the active image", () => {
    const loader = new WodalBytecodeLoader();
    const image = { version: 1, program: { functions: [] } };
    loader.load(image);

    const validation = loader.load({ version: 65536, program: null });

    assert.equal(validation.ok, false);
    assert.deepEqual(
      validation.errors.map((error) => error.code),
      ["INVALID_BYTECODE_VERSION", "MISSING_BYTECODE_PROGRAM"]
    );
    assert.deepEqual(
      validation.errors.map((error) => error.message),
      ["Invalid bytecode version.", "Missing bytecode program."]
    );
    assert.equal(loader.getActiveImage(), image);
  });
});
