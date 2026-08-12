/**
 * Golden observable traces for the button-sensor family: one brain per derived
 * modifier on button A plus one per alternate input (B, A+B, logo), each driven
 * by a scripted button down/up schedule. Every brain pairs the sensor in a
 * rule's when() with the set-pixel actuator in its do(); the rule fires exactly
 * on the ticks its modifier reports. The serialized binary and the rendered
 * trace are pinned beside this spec as the cross-VM button-sensor conformance
 * fixtures: the C++ VM parity test (cpp/test/trace-parity.test.cpp) loads each
 * binary, replays the same schedule, and byte-compares the trace.
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
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId } from "./tile-ids";

/** One scheduled think: optional button/logo levels applied before the time advance. */
interface ScheduleStep {
  /** Simulated milliseconds to advance before the think. */
  readonly advanceMs: number;

  /** When present, button A is set to this level before the advance. */
  readonly a?: boolean;

  /** When present, button B is set to this level before the advance. */
  readonly b?: boolean;

  /** When present, the logo touch is set to this level before the advance. */
  readonly logo?: boolean;
}

/** A button-sensor golden: its sensor, optional modifier, and input schedule. */
interface ButtonFixture {
  /** Fixture base name (the `.mcprogram.bin` / `.ticks.trace` stem). */
  readonly name: string;

  /** Sensor action the brain triggers on. */
  readonly sensor: HostActionIds;

  /** Modifier tile placed on the sensor, or undefined for the default `click`. */
  readonly modifierId?: string;

  /** Scripted input the trace is generated against. */
  readonly schedule: readonly ScheduleStep[];
}

const FIXTURES: readonly ButtonFixture[] = [
  {
    name: "button-pressed",
    sensor: MicroBitV2HostActions.ButtonA,
    modifierId: WodalMicroBitV2ModifierId.Pressed,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 16 }, { advanceMs: 16, a: false }],
  },
  {
    name: "button-released",
    sensor: MicroBitV2HostActions.ButtonA,
    modifierId: WodalMicroBitV2ModifierId.Released,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 16, a: false }],
  },
  {
    name: "button-long-click",
    sensor: MicroBitV2HostActions.ButtonA,
    modifierId: WodalMicroBitV2ModifierId.LongClick,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 1016 }, { advanceMs: 16, a: false }],
  },
  {
    name: "button-double-click",
    sensor: MicroBitV2HostActions.ButtonA,
    modifierId: WodalMicroBitV2ModifierId.DoubleClick,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 16, a: false }, { advanceMs: 16, a: true }],
  },
  {
    name: "button-held",
    sensor: MicroBitV2HostActions.ButtonA,
    modifierId: WodalMicroBitV2ModifierId.Held,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 16 }, { advanceMs: 16, a: false }],
  },
  {
    name: "button-b",
    sensor: MicroBitV2HostActions.ButtonB,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, b: true }, { advanceMs: 16, b: false }],
  },
  {
    name: "button-ab",
    sensor: MicroBitV2HostActions.ButtonAB,
    modifierId: WodalMicroBitV2ModifierId.Pressed,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 16, b: true }],
  },
  {
    name: "button-logo",
    sensor: MicroBitV2HostActions.ButtonLogo,
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, logo: true }, { advanceMs: 16, logo: false }],
  },
];

function fixturePath(name: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}.${extension}`, import.meta.url));
}

/** Builds the sensor -> set-pixel brain image for a fixture through the tile API. */
function buildFixtureImage(
  environment: MindcraftEnvironment,
  fixture: ButtonFixture
): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(fixture.sensor.key));
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
function ensureJsonGolden(fixture: ButtonFixture, jsonPath: string): void {
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

/** Runs a fixture binary over its schedule with the observable-trace observers installed. */
function runFixtureTrace(fixture: ButtonFixture, bin: Uint8Array): { trace: string; microbit: MicroBit } {
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

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of fixture.schedule.entries()) {
    if (step.a !== undefined) {
      microbit.setButtonPressed("A", step.a);
    }
    if (step.b !== undefined) {
      microbit.setButtonPressed("B", step.b);
    }
    if (step.logo !== undefined) {
      microbit.setLogoTouched(step.logo);
    }
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
    if (shouldWriteGolden(binPath)) {
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
    // Every fixture's schedule lands at least one rule fire that lights pixel (0,0).
    assert.ok(lines.some((line) => line.startsWith("port display set-pixel ")));
    assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

    if (shouldWriteGolden(tracePath)) {
      writeFileSync(tracePath, first.trace);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${fixture.name}.ticks.trace is not byte-stable`);
  });
}
