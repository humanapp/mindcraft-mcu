import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramToJson,
} from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import {
  parseWodalProgramImage,
  serializeWodalProgramImageJson,
  type WodalProgramImage,
} from "../../../mindcraft/program-image";
import { MicroBit } from "../microbit";
import { createMicroBitV2Module } from "./module";
import { WodalMicroBitRuntime } from "./runtime";
import { WodalMicroBitV2ActionId } from "./tile-ids";

const GOLDEN_PATH = fileURLToPath(new URL("./__fixtures__/button-display.mcprogram", import.meta.url));

function microbitEnvironment(): MindcraftEnvironment {
  return createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
}

/**
 * Authors the button-A -> set-pixel brain through the tile API: the button-A sensor in the
 * rule's when() and the set-pixel actuator in its do(), with no parameter tiles so the
 * actuator runs with its defaults (x=0, y=0, brightness=255).
 */
function buildButtonDisplayBrainDef(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(WodalMicroBitV2ActionId.ButtonA));
  const actuatorTile = tiles.get(mkActuatorTileId(WodalMicroBitV2ActionId.DisplaySetPixel));
  assert.ok(sensorTile);
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, "button display brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);
  return brainDef;
}

/** Serializes a built (live) program image to a `.mcprogram` JSON string (subphase 5.2). */
function serializeBuiltImage(image: WodalProgramImage<LinkedBrainProgram>): string {
  return serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) });
}

/**
 * Loads a serialized program image into a fresh runtime and asserts that a button-A press
 * lights display pixel (0,0). The environment must install the microbit-v2 module so the
 * load can rebind the host actions.
 */
function assertButtonLightsPixel(
  environment: MindcraftEnvironment,
  image: WodalProgramImage<LinkedBrainProgramJson>
): void {
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(runtime.loadSerializedWodalProgramImage(image), { ok: true });

  // Baseline: button up, no edge, display stays dark.
  runtime.tick(16);
  assert.equal(microbit.display.getPixelValue(0, 0), 0);

  // Released-to-pressed edge fires the rule and lights pixel (0,0) at full brightness.
  microbit.setButtonPressed("A", true);
  runtime.tick(32);
  assert.equal(microbit.display.getPixelValue(0, 0), 255);
}

test("a freshly built button-display image serializes, parses, loads, and runs", () => {
  const environment = microbitEnvironment();
  const built = buildWodalProgramImage({
    brainDef: buildButtonDisplayBrainDef(environment),
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail("expected a successful build");
  }

  const parsed = parseWodalProgramImage(serializeBuiltImage(built.image));
  assert.equal(parsed.ok, true);

  assertButtonLightsPixel(environment, parsed.image as WodalProgramImage<LinkedBrainProgramJson>);
});

test("the committed button-display golden parses, loads, and runs", () => {
  const parsed = parseWodalProgramImage(readFileSync(GOLDEN_PATH, "utf8"));
  assert.equal(parsed.ok, true);

  assertButtonLightsPixel(microbitEnvironment(), parsed.image as WodalProgramImage<LinkedBrainProgramJson>);
});
