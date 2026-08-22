import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BrainDef, mkActuatorTileId, mkSensorTileId, type WendooEnvironment } from "@wendoo/core/app";
import type { LinkedBrainProgram } from "@wendoo/core/runtime";
import {
  buildWodalProgramImage,
  type FirmwareMetadata,
  getWodalDeviceProfile,
  patchFirmwareHex,
  WodalDeviceProfileId,
  type WodalProgramImage,
  wodalProgramBytes,
} from "@wendoo/wodal";
import { createMicroBitV2Environment, MicroBitV2HostActions } from "@wendoo/wodal/targets/microbit-v2";
import { patchFirmwareForImage, programBytesFromImage } from "./firmware-deploy";

const ASSET_DIR = fileURLToPath(new URL("../assets/firmware/", import.meta.url));
const FIRMWARE_HEX_PATH = join(ASSET_DIR, "microbit-v2.hex");
const FIRMWARE_METADATA_PATH = join(ASSET_DIR, "microbit-v2.metadata.json");
const FIRMWARE_HEX = readFileSync(FIRMWARE_HEX_PATH, "utf8");
const FIRMWARE_METADATA = JSON.parse(readFileSync(FIRMWARE_METADATA_PATH, "utf8")) as FirmwareMetadata;

/** The self-contained wodal CLI bundle (a build artifact). */
const CLI_BUNDLE = fileURLToPath(new URL("../../../../packages/wodal/dist/cli/wodal.js", import.meta.url));

/** Authors the button-A -> set-pixel brain through the tile API, as the wodal golden does. */
function buildButtonDisplayBrainDef(env: WendooEnvironment): BrainDef {
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

function buildButtonDisplayImage(env: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef: buildButtonDisplayBrainDef(env),
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail("expected a successful build");
  }
  return built.image;
}

test("the download path patches firmware byte-identically to the wodal core", () => {
  const env = createMicroBitV2Environment();
  const image = buildButtonDisplayImage(env);

  const appResult = patchFirmwareForImage(image, FIRMWARE_HEX, FIRMWARE_METADATA);
  assert.ok(appResult.ok);

  const reference = patchFirmwareHex({
    firmwareHex: FIRMWARE_HEX,
    metadata: FIRMWARE_METADATA,
    program: wodalProgramBytes(programBytesFromImage(image)),
  });
  assert.ok(reference.ok);

  assert.equal(appResult.hex, reference.hex);
});

test("the download path output equals the wodal CLI's patched hex", () => {
  if (!existsSync(CLI_BUNDLE)) {
    // The CLI is a self-contained build artifact; when wodal has not been built the
    // cross-process check is skipped. The byte-equality-to-core test above already
    // asserts the download path matches the same core the CLI invokes verbatim.
    return;
  }
  const env = createMicroBitV2Environment();
  const image = buildButtonDisplayImage(env);

  const appResult = patchFirmwareForImage(image, FIRMWARE_HEX, FIRMWARE_METADATA);
  assert.ok(appResult.ok);

  const dir = mkdtempSync(join(tmpdir(), "wodal-deploy-"));
  const programPath = join(dir, "button-display.mcprogram.bin");
  const outPath = join(dir, "patched.hex");
  writeFileSync(programPath, programBytesFromImage(image));
  execFileSync("node", [
    CLI_BUNDLE,
    "patch",
    "--firmware",
    FIRMWARE_HEX_PATH,
    "--metadata",
    FIRMWARE_METADATA_PATH,
    "--program",
    programPath,
    "--out",
    outPath,
  ]);

  assert.equal(appResult.hex, readFileSync(outPath, "utf8"));
});
