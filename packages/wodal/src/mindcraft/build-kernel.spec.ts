import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { createMicroBitV2Environment } from "../targets/microbit-v2/mindcraft/environment";
import { createMicroBitV2Module } from "../targets/microbit-v2/mindcraft/module";
import { MicroBitV2HostActions } from "../targets/microbit-v2/mindcraft/tile-ids";
import { buildWodalProgramImage, WodalBuildDiagnosticCode } from "./build-kernel";
import { getWodalDeviceProfile, type WodalDeviceProfile, WodalDeviceProfileId } from "./device-profile";

function buildButtonDisplayBrainDef(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key));
  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(sensorTile);
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "button display brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);
  return brainDef;
}

test("buildWodalProgramImage builds a microbit-v2 image from a valid host-tile brain", () => {
  const env = createMicroBitV2Environment();
  const brainDef = buildButtonDisplayBrainDef(env);
  const deviceProfile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);

  const result = buildWodalProgramImage({ brainDef, environment: env, deviceProfile });

  if (!result.ok) {
    assert.fail("expected a successful build");
  }
  assert.equal(result.profileId, WodalDeviceProfileId.MICROBIT_V2);
  assert.equal(result.image.profileId, WodalDeviceProfileId.MICROBIT_V2);
  assert.deepEqual(result.image.program, env.linkBrain(brainDef).program);
});

test("buildWodalProgramImage returns BRAIN_LINK_FAILED when an action cannot be resolved", () => {
  const authoringEnv = createMicroBitV2Environment();
  const brainDef = buildButtonDisplayBrainDef(authoringEnv);
  const linkingEnv = createMindcraftEnvironment({ modules: [coreModule()] });
  const deviceProfile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);

  const result = buildWodalProgramImage({ brainDef, environment: linkingEnv, deviceProfile });

  if (result.ok) {
    assert.fail("expected a failed build");
  }
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.code, WodalBuildDiagnosticCode.BRAIN_LINK_FAILED);
  assert.ok(result.errors[0]!.message.includes(MicroBitV2HostActions.ButtonA.key));
  assert.equal(result.errors[0]!.cause, undefined);
});

test("buildWodalProgramImage returns BRAIN_LINK_FAILED (verbatim) when linkBrain throws, without rethrowing", () => {
  const env = createMicroBitV2Environment();
  const brainDef = buildButtonDisplayBrainDef(env);
  const cause = new Error("linker exploded");
  // A linking environment whose linkBrain throws.
  const throwingEnv = {
    linkBrain() {
      throw cause;
    },
  } as unknown as MindcraftEnvironment;
  const deviceProfile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);

  const result = buildWodalProgramImage({ brainDef, environment: throwingEnv, deviceProfile });

  if (result.ok) {
    assert.fail("expected a failed build");
  }
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.code, WodalBuildDiagnosticCode.BRAIN_LINK_FAILED);
  assert.equal(result.errors[0]!.message, "linker exploded");
  assert.equal(result.errors[0]!.cause, cause);
});

test("buildWodalProgramImage returns PROGRAM_IMAGE_CREATION_FAILED when image creation throws", () => {
  const env = createMicroBitV2Environment();
  const brainDef = buildButtonDisplayBrainDef(env);
  const cause = new Error("image creation failed");
  const deviceProfile: WodalDeviceProfile = {
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    numericProfileId: 1,
    numberPrecision: "f32",
    defaultBudget: 1000,
    hookBudget: 10000,
    maxFibers: 100,
    maxStackSize: 256,
    maxLocalsSize: 256,
    maxFrameDepth: 64,
    maxHandlers: 16,
    maxHandles: 8,
    createMindcraftModule: createMicroBitV2Module,
    createProgramImage: () => {
      throw cause;
    },
  };

  const result = buildWodalProgramImage({ brainDef, environment: env, deviceProfile });

  if (result.ok) {
    assert.fail("expected a failed build");
  }
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.code, WodalBuildDiagnosticCode.PROGRAM_IMAGE_CREATION_FAILED);
  assert.equal(result.errors[0]!.cause, cause);
});
