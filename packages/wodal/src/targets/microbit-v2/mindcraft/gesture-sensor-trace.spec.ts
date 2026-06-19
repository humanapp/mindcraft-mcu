/**
 * Golden observable traces for the gesture sensor: one brain per core gesture
 * modifier (shake, the four tilts, the two faces, freefall) plus the no-modifier
 * default (shake), each driven by a scripted gesture-code schedule. Every brain
 * pairs the gesture sensor in a rule's when() with the set-pixel actuator in its
 * do(); the rule fires exactly on the tick the injected gesture equals the tile's
 * modifier. The serialized binary and the rendered trace are pinned beside this
 * spec as the cross-VM gesture conformance fixtures: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads each binary, replays the same schedule,
 * and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type HostActionIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { AccelerometerGesture } from "../../../core/accelerometer";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId } from "./tile-ids";

/** One scheduled think: the injected gesture code applied before the time advance. */
interface ScheduleStep {
  readonly advanceMs: number;
  readonly gesture: AccelerometerGesture;
}

/** A gesture golden: its modifier and the gesture-code schedule it runs against. */
interface GestureFixture {
  readonly name: string;
  readonly modifierId?: string;
  readonly schedule: readonly ScheduleStep[];
}

/** A schedule proving fire-on-own and no-fire-on-idle and no-fire-on-different. */
function schedule(own: AccelerometerGesture, other: AccelerometerGesture): readonly ScheduleStep[] {
  return [
    { advanceMs: 16, gesture: AccelerometerGesture.None },
    { advanceMs: 16, gesture: own },
    { advanceMs: 16, gesture: other },
  ];
}

const FIXTURES: readonly GestureFixture[] = [
  {
    name: "gesture-shake",
    modifierId: WodalMicroBitV2ModifierId.Shake,
    schedule: schedule(AccelerometerGesture.Shake, AccelerometerGesture.TiltUp),
  },
  {
    name: "gesture-tilt-up",
    modifierId: WodalMicroBitV2ModifierId.TiltUp,
    schedule: schedule(AccelerometerGesture.TiltUp, AccelerometerGesture.Shake),
  },
  {
    name: "gesture-tilt-down",
    modifierId: WodalMicroBitV2ModifierId.TiltDown,
    schedule: schedule(AccelerometerGesture.TiltDown, AccelerometerGesture.TiltUp),
  },
  {
    name: "gesture-tilt-left",
    modifierId: WodalMicroBitV2ModifierId.TiltLeft,
    schedule: schedule(AccelerometerGesture.TiltLeft, AccelerometerGesture.TiltRight),
  },
  {
    name: "gesture-tilt-right",
    modifierId: WodalMicroBitV2ModifierId.TiltRight,
    schedule: schedule(AccelerometerGesture.TiltRight, AccelerometerGesture.TiltLeft),
  },
  {
    name: "gesture-face-up",
    modifierId: WodalMicroBitV2ModifierId.FaceUp,
    schedule: schedule(AccelerometerGesture.FaceUp, AccelerometerGesture.FaceDown),
  },
  {
    name: "gesture-face-down",
    modifierId: WodalMicroBitV2ModifierId.FaceDown,
    schedule: schedule(AccelerometerGesture.FaceDown, AccelerometerGesture.FaceUp),
  },
  {
    name: "gesture-freefall",
    modifierId: WodalMicroBitV2ModifierId.Freefall,
    schedule: schedule(AccelerometerGesture.Freefall, AccelerometerGesture.Shake),
  },
  {
    // No modifier: the body resolves the default to shake.
    name: "gesture-default",
    schedule: schedule(AccelerometerGesture.Shake, AccelerometerGesture.TiltUp),
  },
];

function fixturePath(name: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}.${extension}`, import.meta.url));
}

/** Builds the gesture-sensor -> set-pixel brain image for a fixture through the tile API. */
function buildFixtureImage(
  environment: MindcraftEnvironment,
  fixture: GestureFixture
): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.Gesture.key));
  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(sensorTile);
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${fixture.name} brain`);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  if (fixture.modifierId !== undefined) {
    const modifierTile = tiles.get(mkModifierTileId(fixture.modifierId));
    assert.ok(modifierTile);
    rule.when().appendTile(modifierTile);
  }
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

/**
 * Writes the fixture's JSON `.mcprogram` golden if it does not exist. The JSON
 * freezes the brain's generated id; the binary and trace goldens derive from it
 * deterministically.
 */
function ensureJsonGolden(fixture: GestureFixture, jsonPath: string): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildFixtureImage(environment, fixture);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Derives the binary `.mcprogram` payload from the committed JSON golden. */
function binFromCommittedJson(jsonPath: string): Uint8Array {
  return wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
}

/** Runs a fixture binary over its schedule with the observable-trace taps installed. */
function runFixtureTrace(fixture: GestureFixture, bin: Uint8Array): { trace: string; microbit: MicroBit } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
  });

  const actions = environment.brainServices.runtime.actions;
  for (const { actionId } of [MicroBitV2HostActions.Gesture, MicroBitV2HostActions.DisplaySetPixel]) {
    const action = actions.getById(actionId);
    assert.ok(action !== undefined && action.binding === "host");
    const exec = action.execSync;
    assert.ok(exec !== undefined);
    action.execSync = (ctx, args) => {
      const result = exec(ctx, args);
      const callSiteId = ctx.currentCallSiteId;
      assert.ok(callSiteId !== undefined);
      writer.hostActionCall(actionId, callSiteId, args, result);
      return result;
    };
  }

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents: VmEvents = {
    onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code),
  };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of fixture.schedule.entries()) {
    microbit.accelerometer.setGesture(step.gesture);
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

for (const fixture of FIXTURES) {
  test(`the committed ${fixture.name} binary and observable trace golden are byte-stable`, () => {
    const jsonPath = fixturePath(fixture.name, "mcprogram");
    const binPath = fixturePath(fixture.name, "mcprogram.bin");
    const tracePath = fixturePath(fixture.name, "ticks.trace");

    ensureJsonGolden(fixture, jsonPath);
    const generated = binFromCommittedJson(jsonPath);
    if (!existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${fixture.name}.mcprogram.bin is not byte-stable`);

    const first = runFixtureTrace(fixture, bin);
    const second = runFixtureTrace(fixture, bin);
    assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

    const lines = first.trace.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("tick ")).length, fixture.schedule.length);
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
    // The matching gesture fires on exactly one tick, lighting pixel (0,0); the
    // idle and different-gesture ticks do not fire.
    assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
    assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

    if (!existsSync(tracePath)) {
      writeFileSync(tracePath, first.trace);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${fixture.name}.ticks.trace is not byte-stable`);
  });
}
