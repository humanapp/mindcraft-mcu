import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WODAL_MICROBIT_V2_MODULE_ID } from "../targets/microbit-v2/mindcraft/module";
import {
  getWodalDeviceProfile,
  isWodalDeviceProfileId,
  WODAL_DEVICE_PROFILE_IDS,
  WODAL_DEVICE_PROFILES,
  WodalDeviceProfileId,
} from "./device-profile";

describe("WODAL device profiles", () => {
  it("maps the microbit-v2 profile id to its Mindcraft module factory", () => {
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const module = profile.createMindcraftModule();

    assert.equal(profile.profileId, WodalDeviceProfileId.MICROBIT_V2);
    assert.equal(module.id, WODAL_MICROBIT_V2_MODULE_ID);
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
