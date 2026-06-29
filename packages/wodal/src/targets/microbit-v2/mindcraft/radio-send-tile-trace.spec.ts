/**
 * Golden observable traces for the `radio send` tile: brains pairing the button
 * sensor in a rule's when() with `radio send` in its do(), driven by a scripted
 * button schedule. One brain sends with no argument (forwarding the rule's
 * WHEN-result, a boolean that sends as a NUMBER 0/1); the other sends an
 * explicit number literal. The serialized binary and the rendered trace are
 * pinned beside this spec as the cross-VM conformance fixtures; the C++ VM
 * parity test loads each binary, replays the same schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BrainTileLiteralDef,
  CoreTypeIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkNumberValue,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

interface SendFixture {
  readonly name: string;

  /** Explicit number literal placed in the send slot, or undefined for the no-arg WHEN-result form. */
  readonly explicit?: number;
}

const FIXTURES: readonly SendFixture[] = [
  { name: "radio-send-when-result" },
  { name: "radio-send-explicit", explicit: 5 },
];

/** Button A pressed at tick 2, released at tick 3. */
const SCHEDULE: readonly { advanceMs: number; a?: boolean }[] = [
  { advanceMs: 16 },
  { advanceMs: 16, a: true },
  { advanceMs: 16, a: false },
];

function fixturePath(name: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}.${extension}`, import.meta.url));
}

function buildFixtureImage(
  environment: MindcraftEnvironment,
  fixture: SendFixture
): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  // Button A with no modifier reports a press, firing on the press edge.
  const sensorTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key));
  const sendTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.RadioSend.key));
  assert.ok(sensorTile);
  assert.ok(sendTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${fixture.name} brain`);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(sendTile);
  if (fixture.explicit !== undefined) {
    const literal = new BrainTileLiteralDef(
      CoreTypeIds.Number,
      mkNumberValue(fixture.explicit),
      { valueLabel: String(fixture.explicit), persist: true },
      environment.brainServices
    );
    rule.do().appendTile(literal);
  }

  const built = buildWodalProgramImage({
    brainDef,
    environment,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

function ensureJsonGolden(fixture: SendFixture, jsonPath: string): void {
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

function runFixtureTrace(bin: Uint8Array): string {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const microbit = new MicroBit();
  const deviceSend = microbit.radio.send.bind(microbit.radio);
  microbit.radio.send = (record) => {
    writer.radioSend(record);
    return deviceSend(record);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of SCHEDULE.entries()) {
    if (step.a !== undefined) {
      microbit.setButtonPressed("A", step.a);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

for (const fixture of FIXTURES) {
  test(`the committed ${fixture.name} binary and observable trace golden are byte-stable`, () => {
    const jsonPath = fixturePath(fixture.name, "mcprogram");
    const binPath = fixturePath(fixture.name, "mcprogram.bin");
    const tracePath = fixturePath(fixture.name, "ticks.trace");

    ensureJsonGolden(fixture, jsonPath);
    const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
    if (!existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${fixture.name}.mcprogram.bin is not byte-stable`);

    const first = runFixtureTrace(bin);
    const second = runFixtureTrace(bin);
    assert.equal(second, first, "two fresh runs must render byte-identical traces");

    const lines = first.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
    assert.equal(lines.filter((line) => line.startsWith("port radio send ")).length, 1);

    if (!existsSync(tracePath)) {
      writeFileSync(tracePath, first);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first, `${fixture.name}.ticks.trace is not byte-stable`);
  });
}
