import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type MindcraftEnvironment, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramToJson,
  Op,
} from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import {
  parseWodalProgramImage,
  serializeWodalProgramImageJson,
  type WodalProgramImage,
} from "../../../mindcraft/program-image";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const GOLDEN_PATH = fileURLToPath(new URL("./__fixtures__/button-display.mcprogram", import.meta.url));

function microbitEnvironment(): MindcraftEnvironment {
  return createMicroBitV2Environment();
}

/**
 * Authors the button-A -> set-pixel brain through the tile API: the button-A sensor in the
 * rule's when() and the set-pixel actuator in its do(), with no parameter tiles so the
 * actuator runs with its defaults (x=0, y=0, brightness=255).
 */
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

/** Serializes a built (live) program image to a `.mcprogram` JSON string (subphase 5.2). */
function serializeBuiltImage(image: WodalProgramImage<LinkedBrainProgram>): string {
  return serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) });
}

/**
 * Loads a serialized program image into a fresh runtime and asserts that a button-A press
 * lights display pixel (0,0). The environment must install the microbit-v2 module so the
 * serialized host action ids resolve against the runtime action registry.
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
  const parsed = parseWodalProgramImage(serializeBuiltImage(buildGoldenImage(environment)));
  assert.equal(parsed.ok, true);

  assertButtonLightsPixel(environment, parsed.image as WodalProgramImage<LinkedBrainProgramJson>);
});

/** Builds the button-display image through the standard build path for the golden. */
function buildGoldenImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef: buildButtonDisplayBrainDef(environment),
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail("expected a successful build");
  }
  return built.image;
}

test("the committed button-display golden parses, loads, and runs", () => {
  if (!existsSync(GOLDEN_PATH)) {
    writeFileSync(GOLDEN_PATH, serializeBuiltImage(buildGoldenImage(microbitEnvironment())));
  }
  const parsed = parseWodalProgramImage(readFileSync(GOLDEN_PATH, "utf8"));
  assert.equal(parsed.ok, true);

  assertButtonLightsPixel(microbitEnvironment(), parsed.image as WodalProgramImage<LinkedBrainProgramJson>);
});

test("the committed golden's host action calls carry the declared stable action ids", () => {
  if (!existsSync(GOLDEN_PATH)) {
    writeFileSync(GOLDEN_PATH, serializeBuiltImage(buildGoldenImage(microbitEnvironment())));
  }
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number; a?: number }[] }[] } };
  };

  const actionIds: number[] = [];
  for (const fn of golden.program.program.functions) {
    for (const ins of fn.code) {
      if (ins.op === Op.HOST_ACTION_CALL || ins.op === Op.HOST_ACTION_CALL_ASYNC) {
        actionIds.push(ins.a ?? -1);
      }
    }
  }
  assert.deepEqual(
    actionIds.sort((a, b) => a - b),
    [MicroBitV2HostActions.ButtonA.actionId, MicroBitV2HostActions.DisplaySetPixel.actionId]
  );
});
