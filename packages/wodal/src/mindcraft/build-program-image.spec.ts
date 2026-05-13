import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkedBrainProgram } from "@mindcraft-lang/core/runtime";
import { createWodalProgramImageForProfile } from "./build-program-image";
import { WodalDeviceProfileId } from "./device-profile";
import { WODAL_PROGRAM_IMAGE_FORMAT, WODAL_PROGRAM_IMAGE_VERSION } from "./program-image";

describe("createWodalProgramImageForProfile", () => {
  it("creates a microbit-v2 program image through the device profile registry", () => {
    const linkedBrain = { program: "linked-brain" } as unknown as LinkedBrainProgram;
    const image = createWodalProgramImageForProfile({
      profileId: WodalDeviceProfileId.MICROBIT_V2,
      program: linkedBrain,
    });

    assert.deepEqual(image, {
      format: WODAL_PROGRAM_IMAGE_FORMAT,
      version: WODAL_PROGRAM_IMAGE_VERSION,
      profileId: WodalDeviceProfileId.MICROBIT_V2,
      program: linkedBrain,
    });
    assert.equal(image.program, linkedBrain);
  });
});
