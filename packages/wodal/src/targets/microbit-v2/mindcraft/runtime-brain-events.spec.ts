import assert from "node:assert/strict";
import { test } from "node:test";
import { type MindcraftEnvironment, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import type { LinkedBrainProgram, RuleWhenGateEvent } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import type { WodalProgramImage } from "../../../mindcraft/program-image";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

/** A one-rule brain: when button A is pressed, light display pixel (0,0). */
function buildButtonDisplayImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key));
  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(sensorTile);
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "button display brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);

  const built = buildWodalProgramImage({
    brainDef,
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail("expected a successful build");
  }
  return built.image;
}

test("the runtime exposes the loaded brain's event stream only while a program is loaded", () => {
  const environment = createMicroBitV2Environment();
  const image = buildButtonDisplayImage(environment);
  const runtime = new WodalMicroBitRuntime({ environment });

  assert.equal(runtime.brainEvents(), undefined);

  assert.deepEqual(runtime.loadWodalProgramImage(image), { ok: true });
  assert.notEqual(runtime.brainEvents(), undefined);

  runtime.unload();
  assert.equal(runtime.brainEvents(), undefined);
});

test("the exposed event stream reports the loaded brain's rule gate decisions", () => {
  const environment = createMicroBitV2Environment();
  const image = buildButtonDisplayImage(environment);
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(runtime.loadWodalProgramImage(image), { ok: true });

  const gates: RuleWhenGateEvent[] = [];
  runtime.brainEvents()?.on("rule_when_evaluated", (event) => {
    gates.push(event);
  });

  runtime.tick(16);
  assert.ok(gates.length > 0, "a think evaluates the rule's gate");
  assert.equal(
    gates.every((gate) => !gate.fired),
    true
  );

  gates.length = 0;
  microbit.setButtonPressed("A", true);
  runtime.tick(32);
  assert.equal(
    gates.some((gate) => gate.fired),
    true
  );
});
