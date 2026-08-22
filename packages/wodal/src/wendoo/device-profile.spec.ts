import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LinkedBrainProgram } from "@wendoo-lang/core/runtime";
import { WENDOO_PROGRAM_IMAGE_FORMAT, WENDOO_PROGRAM_IMAGE_VERSION } from "@wendoo-lang/service-api";
import { WODAL_MICROBIT_V2_MODULE_ID } from "../targets/microbit-v2/wendoo/module";
import {
  getWodalDeviceProfile,
  isWodalDeviceProfileId,
  WODAL_DEVICE_PROFILE_IDS,
  WODAL_DEVICE_PROFILES,
  WodalDeviceProfileId,
} from "./device-profile";

describe("WODAL device profiles", () => {
  it("maps the microbit-v2 profile id to its Wendoo module factory", () => {
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const module = profile.createWendooModule();

    assert.equal(profile.profileId, WodalDeviceProfileId.MICROBIT_V2);
    assert.equal(module.id, WODAL_MICROBIT_V2_MODULE_ID);
  });

  it("maps the microbit-v2 profile id to its program image factory", () => {
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const linkedBrain = { program: "linked-brain" } as unknown as LinkedBrainProgram;

    assert.deepEqual(profile.createProgramImage(linkedBrain), {
      format: WENDOO_PROGRAM_IMAGE_FORMAT,
      version: WENDOO_PROGRAM_IMAGE_VERSION,
      profileId: WodalDeviceProfileId.MICROBIT_V2,
      program: linkedBrain,
    });
  });

  it("checks supported profile ids", () => {
    assert.equal(isWodalDeviceProfileId(WodalDeviceProfileId.MICROBIT_V2), true);
    assert.equal(isWodalDeviceProfileId("microbit-v1"), false);
    assert.equal(isWodalDeviceProfileId(undefined), false);
  });

  it("exposes immutable profile catalog objects", () => {
    assert.equal(Object.isFrozen(WODAL_DEVICE_PROFILE_IDS), true);
    assert.equal(Object.isFrozen(WODAL_DEVICE_PROFILES), true);
    assert.equal(Object.isFrozen(WODAL_DEVICE_PROFILES[WodalDeviceProfileId.MICROBIT_V2]), true);
  });
});
