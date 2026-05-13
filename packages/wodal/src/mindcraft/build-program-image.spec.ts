import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { MINDCRAFT_PROGRAM_IMAGE_FORMAT, MINDCRAFT_PROGRAM_IMAGE_VERSION } from "@mindcraft-lang/service-api";
import { createWodalProgramImageForProfile } from "./build-program-image";
import { WodalDeviceProfileId } from "./device-profile";
import { parseWodalProgramImage, serializeWodalProgramImageJson } from "./program-image";

describe("createWodalProgramImageForProfile", () => {
  it("creates a microbit-v2 program image through the device profile registry", () => {
    const linkedBrain = { program: "linked-brain" } as unknown as LinkedBrainProgram;
    const image = createWodalProgramImageForProfile({
      profileId: WodalDeviceProfileId.MICROBIT_V2,
      program: linkedBrain,
    });

    assert.deepEqual(image, {
      format: MINDCRAFT_PROGRAM_IMAGE_FORMAT,
      version: MINDCRAFT_PROGRAM_IMAGE_VERSION,
      profileId: WodalDeviceProfileId.MICROBIT_V2,
      program: linkedBrain,
    });
    assert.equal(image.program, linkedBrain);
  });

  it("preserves the registry-created profile id across JSON serialization", () => {
    const linkedBrain = { program: "linked-brain" } as unknown as LinkedBrainProgram;
    const image = createWodalProgramImageForProfile({
      profileId: WodalDeviceProfileId.MICROBIT_V2,
      program: linkedBrain,
    });
    const result = parseWodalProgramImage(serializeWodalProgramImageJson(image));

    assert.equal(result.ok, true);
    assert.equal(result.image.profileId, WodalDeviceProfileId.MICROBIT_V2);
    assert.deepEqual(result.image.program, linkedBrain);
  });
});
