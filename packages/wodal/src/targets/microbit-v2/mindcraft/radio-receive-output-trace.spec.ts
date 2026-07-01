/**
 * Golden observable traces for the radio receive sensor output tiles: brains
 * pairing `radio receive number` / `radio receive string` in a rule's when()
 * with `radio send` in its do(), where the send's value slot is filled by one of
 * the receive sensor's output value-tiles (`value` or `signal strength`). A
 * scripted schedule injects one packet into the receive ring; the rule fires,
 * reads the output tile, and sends its value back out, so the injected packet's
 * value (and, for the signal-strength fixture, its RSSI) round-trips through the
 * output tile to the radio send. The `value` fixtures confirm the delivered
 * value reaches the send; the `signal strength` fixture sends the RSSI, a value
 * the received number itself does not carry, isolating the output-tile read from
 * the WHEN-result fallback. The serialized binary and the rendered trace are
 * pinned beside this spec; the cpp conformance suite decodes each binary on the
 * C++ VM (the output read lowers to the shared RuleContextGetVariable host call,
 * so no new opcode crosses the VM boundary).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreTypeIds,
  type HostActionIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkOutputTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import {
  type IncomingRadioPacket,
  RadioPacketType,
  type RadioSendRecord,
  radioNumberIsInteger,
} from "../../../core/radio";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

/** Fixed metadata stamped on every injected packet; the RSSI fixture round-trips this value. */
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

/** Asserts the one packet the rule sent matches the expected typed payload. */
type SendAssertion = (record: RadioSendRecord) => void;

/** A receive-output golden: the receive sensor, the output tile it reads, and the injected packet. */
interface OutputFixture {
  readonly name: string;

  /** The receive sensor placed on the rule's when(). */
  readonly sensor: HostActionIds;

  /** Output identity (type + name) of the tile filling the radio send slot. */
  readonly outputType: string;
  readonly outputName: string;

  /** The single packet injected before the firing think. */
  readonly inject: IncomingRadioPacket;

  /** Asserts the value the rule sent (the output tile's value). */
  readonly expectSend: SendAssertion;
}

const NUMBER = MicroBitV2HostActions.RadioReceiveNumber;
const STRING = MicroBitV2HostActions.RadioReceiveString;

const FIXTURES: readonly OutputFixture[] = [
  {
    name: "radio-receive-output-string-value",
    sensor: STRING,
    outputType: CoreTypeIds.String,
    outputName: "value",
    inject: stringPacket("hi"),
    expectSend: (record) => {
      assert.equal(record.type, RadioPacketType.String);
      assert.equal(record.text, "hi");
    },
  },
  {
    name: "radio-receive-output-number-value",
    sensor: NUMBER,
    outputType: CoreTypeIds.Number,
    outputName: "value",
    inject: numberPacket(7),
    expectSend: (record) => {
      assert.equal(record.type, RadioPacketType.Number);
      assert.equal(record.value, 7);
    },
  },
  {
    // The signal-strength output carries the packet RSSI, so the rule sends the
    // injected RSSI (-42); the received number 7 reaches only the value output.
    name: "radio-receive-output-rssi",
    sensor: NUMBER,
    outputType: CoreTypeIds.Number,
    outputName: "rssi",
    inject: numberPacket(7),
    expectSend: (record) => {
      assert.equal(record.type, RadioPacketType.Number);
      assert.equal(record.value, INJECT_RSSI);
    },
  },
];

/** Three scheduled thinks: arm the cursor, inject one packet, then quiesce. */
const SCHEDULE: readonly { advanceMs: number }[] = [{ advanceMs: 16 }, { advanceMs: 16 }, { advanceMs: 16 }];

/** Schedule index of the think whose preceding inject delivers the fixture packet. */
const INJECT_AT_INDEX = 1;

function fixturePath(name: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}.${extension}`, import.meta.url));
}

/** Builds the `receive -> radio send <output tile>` brain image through the tile API. */
function buildFixtureImage(
  environment: MindcraftEnvironment,
  fixture: OutputFixture
): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const sensorTile = tiles.get(mkSensorTileId(fixture.sensor.key));
  const sendTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.RadioSend.key));
  const outputTile = tiles.get(mkOutputTileId(fixture.outputType, fixture.outputName));
  assert.ok(sensorTile);
  assert.ok(sendTile);
  assert.ok(outputTile, `output tile '${fixture.outputName}' should be registered`);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${fixture.name} brain`);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(sendTile);
  rule.do().appendTile(outputTile);

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

function ensureJsonGolden(fixture: OutputFixture, jsonPath: string): void {
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
function runFixtureTrace(fixture: OutputFixture, bin: Uint8Array): { trace: string; sends: RadioSendRecord[] } {
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
  for (const actionId of [fixture.sensor.actionId, MicroBitV2HostActions.RadioSend.actionId]) {
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
  const sends: RadioSendRecord[] = [];
  const deviceSend = microbit.radio.send.bind(microbit.radio);
  microbit.radio.send = (record) => {
    writer.radioSend(record);
    sends.push(record);
    return deviceSend(record);
  };

  const vmEvents: VmEvents = {
    onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code),
  };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of SCHEDULE.entries()) {
    if (index === INJECT_AT_INDEX) {
      microbit.radio.deliver(fixture.inject);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), sends };
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
    assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
    // The rule fires once (for the single injected packet) and sends one packet.
    assert.equal(lines.filter((line) => line.startsWith("port radio send ")).length, 1);

    // The output tile's value reaches the radio send unchanged across both runs.
    assert.equal(first.sends.length, 1);
    assert.equal(second.sends.length, 1);
    fixture.expectSend(first.sends[0]!);
    fixture.expectSend(second.sends[0]!);

    if (!existsSync(tracePath)) {
      writeFileSync(tracePath, first.trace);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${fixture.name}.ticks.trace is not byte-stable`);
  });
}
