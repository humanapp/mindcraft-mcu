/**
 * Golden observable traces for the radio receive sensors: brains pairing
 * `radio receive number` / `radio receive string` / `radio receive buffer` in a
 * rule's when() with the set-pixel actuator in its do(), driven by a scripted
 * schedule that injects
 * radio packets into the device receive ring between thinks (the same
 * inject-as-input pattern the button goldens use for presses). The fixtures
 * exercise single delivery, a multi-packet burst drained one-per-think, mixed
 * types self-filtering, two sensors both firing for one packet, ring overflow
 * with a lagging cursor snapping forward, and page-enter cursor freshness. The
 * serialized binary and the rendered trace are pinned beside this spec as the
 * cross-VM conformance fixtures: the C++ VM parity test loads each binary,
 * replays the same injected schedule, and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type HostActionIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { type IncomingRadioPacket, RadioPacketType, radioNumberIsInteger } from "../../../core/radio";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

/** Fixed metadata stamped on every injected packet (the tile sensors read only the value). */
const INJECT_RSSI = -42;
const INJECT_SERIAL = 0;
const INJECT_GROUP = 0;

/** Builds a number packet, choosing NUMBER or DOUBLE the way a real sender would. */
function numberPacket(value: number): IncomingRadioPacket {
  return {
    type: radioNumberIsInteger(value) ? RadioPacketType.Number : RadioPacketType.Double,
    group: INJECT_GROUP,
    value,
    name: "",
    text: "",
    bytes: new Uint8Array(0),
    rssi: INJECT_RSSI,
    serial: INJECT_SERIAL,
    time: 0,
  };
}

/** Builds a string packet. */
function stringPacket(text: string): IncomingRadioPacket {
  return {
    type: RadioPacketType.String,
    group: INJECT_GROUP,
    value: 0,
    name: "",
    text,
    bytes: new Uint8Array(0),
    rssi: INJECT_RSSI,
    serial: INJECT_SERIAL,
    time: 0,
  };
}

/** Builds a buffer packet. */
function bufferPacket(bytes: readonly number[]): IncomingRadioPacket {
  return {
    type: RadioPacketType.Buffer,
    group: INJECT_GROUP,
    value: 0,
    name: "",
    text: "",
    bytes: new Uint8Array(bytes),
    rssi: INJECT_RSSI,
    serial: INJECT_SERIAL,
    time: 0,
  };
}

/** One scheduled think: packets injected into the ring before the time advance, then the advance. */
interface ScheduleStep {
  readonly advanceMs: number;
  readonly inject?: readonly IncomingRadioPacket[];
}

/** A receive golden: the sensor placed on each rule, and the injected packet schedule. */
interface ReceiveFixture {
  readonly name: string;

  /** One sensor per rule on the single page, in rule order. */
  readonly rules: readonly HostActionIds[];

  /** Scripted packet injections the trace is generated against. */
  readonly schedule: readonly ScheduleStep[];
}

const NUMBER = MicroBitV2HostActions.RadioReceiveNumber;
const STRING = MicroBitV2HostActions.RadioReceiveString;
const BUFFER = MicroBitV2HostActions.RadioReceiveBuffer;

const FIXTURES: readonly ReceiveFixture[] = [
  {
    name: "radio-receive-number-single",
    rules: [NUMBER],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, inject: [numberPacket(7)] }, { advanceMs: 16 }],
  },
  {
    // Presence gate: a delivered 0 is falsy but present, so the rule fires.
    name: "radio-receive-number-zero",
    rules: [NUMBER],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, inject: [numberPacket(0)] }, { advanceMs: 16 }],
  },
  {
    // Presence gate: a delivered empty string is falsy but present, so the rule fires.
    name: "radio-receive-string-empty",
    rules: [STRING],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, inject: [stringPacket("")] }, { advanceMs: 16 }],
  },
  {
    name: "radio-receive-number-burst",
    rules: [NUMBER],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, inject: [numberPacket(10), numberPacket(20), numberPacket(30)] },
      { advanceMs: 16 },
      { advanceMs: 16 },
    ],
  },
  {
    name: "radio-receive-mixed",
    rules: [NUMBER, STRING],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, inject: [numberPacket(5), stringPacket("hi"), numberPacket(6), stringPacket("yo")] },
      { advanceMs: 16 },
      { advanceMs: 16 },
    ],
  },
  {
    name: "radio-receive-both-fire",
    rules: [NUMBER, NUMBER],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, inject: [numberPacket(9)] }, { advanceMs: 16 }],
  },
  {
    name: "radio-receive-overflow",
    rules: [NUMBER],
    schedule: [
      { advanceMs: 16 },
      {
        advanceMs: 16,
        inject: [numberPacket(1), numberPacket(2), numberPacket(3), numberPacket(4), numberPacket(5)],
      },
      { advanceMs: 16 },
      { advanceMs: 16 },
      { advanceMs: 16 },
      { advanceMs: 16 },
    ],
  },
  {
    name: "radio-receive-freshness",
    rules: [NUMBER],
    schedule: [
      { advanceMs: 16, inject: [numberPacket(99)] },
      { advanceMs: 16 },
      { advanceMs: 16, inject: [numberPacket(7)] },
      { advanceMs: 16 },
    ],
  },
  {
    name: "radio-receive-buffer-single",
    rules: [BUFFER],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, inject: [bufferPacket([0x01, 0x00, 0xab])] }, { advanceMs: 16 }],
  },
  {
    // Presence gate: a delivered empty buffer is present, so the rule fires.
    name: "radio-receive-buffer-empty",
    rules: [BUFFER],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, inject: [bufferPacket([])] }, { advanceMs: 16 }],
  },
  {
    // Two buffers drain one per think; the number sensor picks up the number the
    // buffer sensor skips; a number-only think leaves the buffer rule silent.
    name: "radio-receive-buffer-mixed",
    rules: [BUFFER, NUMBER],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, inject: [bufferPacket([0x01, 0xff, 0x7f]), numberPacket(5), bufferPacket([0x0a, 0x0b])] },
      { advanceMs: 16 },
      { advanceMs: 16, inject: [numberPacket(6)] },
      { advanceMs: 16 },
    ],
  },
];

function fixturePath(name: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}.${extension}`, import.meta.url));
}

/** Builds the sensor(s) -> set-pixel brain image for a fixture through the tile API. */
function buildFixtureImage(
  environment: MindcraftEnvironment,
  fixture: ReceiveFixture
): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const actuatorTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(actuatorTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${fixture.name} brain`);
  const page = brainDef.pages().get(0)!;
  fixture.rules.forEach((sensor, index) => {
    const sensorTile = tiles.get(mkSensorTileId(sensor.key));
    assert.ok(sensorTile);
    const rule = index === 0 ? page.children().get(0) : page.appendNewRule();
    assert.ok(rule);
    rule.when().appendTile(sensorTile);
    rule.do().appendTile(actuatorTile);
  });

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

function ensureJsonGolden(fixture: ReceiveFixture, jsonPath: string): void {
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

function binFromCommittedJson(jsonPath: string): Uint8Array {
  return wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
}

/** Runs a fixture binary over its injected-packet schedule with the trace taps installed. */
function runFixtureTrace(fixture: ReceiveFixture, bin: Uint8Array): string {
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
  const tappedIds = new Set<number>([
    ...fixture.rules.map((r) => r.actionId),
    MicroBitV2HostActions.DisplaySetPixel.actionId,
  ]);
  for (const actionId of tappedIds) {
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
    for (const packet of step.inject ?? []) {
      microbit.radio.deliver(packet);
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
    const generated = binFromCommittedJson(jsonPath);
    if (!existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${fixture.name}.mcprogram.bin is not byte-stable`);

    const first = runFixtureTrace(fixture, bin);
    const second = runFixtureTrace(fixture, bin);
    assert.equal(second, first, "two fresh runs must render byte-identical traces");

    const lines = first.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("tick ")).length, fixture.schedule.length);
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

    if (!existsSync(tracePath)) {
      writeFileSync(tracePath, first);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first, `${fixture.name}.ticks.trace is not byte-stable`);
  });
}
