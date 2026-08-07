/**
 * Golden observable trace for two output-providing radio receive sensors in one
 * brain: rule 1 pairs `radio receive number` with `radio send` filled by the
 * number sensor's `value` output tile; rule 2 pairs `radio receive string` with
 * `radio send` filled by the string sensor's `value` output tile. A single think
 * delivers both a number and a string packet, so both rules fire; each rule sends
 * its own provider's value. Because the two `value` outputs have distinct identity
 * keys (`__out.number.value` vs `__out.string.value`), each provider's value
 * reaches its own send with no leak between providers - the runtime side of the
 * identity-key isolation the gating test asserts at edit time. The serialized
 * binary and rendered trace are pinned beside this spec; the cpp conformance suite
 * decodes the binary on the C++ VM (the output reads are RuleContextGetVariable).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreTypeIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkOutputTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
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
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const NAME = "radio-receive-output-multi-provider";

/** Fixed metadata stamped on every injected packet. */
const INJECT_RSSI = -42;

/** The number and string values delivered on the firing think. */
const NUMBER_VALUE = 7;
const STRING_VALUE = "hi";

function numberPacket(value: number): IncomingRadioPacket {
  return {
    type: radioNumberIsInteger(value) ? RadioPacketType.Number : RadioPacketType.Double,
    group: 0,
    value,
    name: "",
    text: "",
    bytes: new Uint8Array(0),
    rssi: INJECT_RSSI,
    serial: 0,
    time: 0,
  };
}

function stringPacket(text: string): IncomingRadioPacket {
  return {
    type: RadioPacketType.String,
    group: 0,
    value: 0,
    name: "",
    text,
    bytes: new Uint8Array(0),
    rssi: INJECT_RSSI,
    serial: 0,
    time: 0,
  };
}

/** Three thinks: arm both cursors, deliver both packets (both rules fire), quiesce. */
const SCHEDULE: readonly { advanceMs: number; inject?: readonly IncomingRadioPacket[] }[] = [
  { advanceMs: 16 },
  { advanceMs: 16, inject: [numberPacket(NUMBER_VALUE), stringPacket(STRING_VALUE)] },
  { advanceMs: 16 },
];

function fixturePath(extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${NAME}.${extension}`, import.meta.url));
}

/** Builds the two-provider brain: each receive sensor sends its own `value` output. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const sendTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.RadioSend.key));
  const numberSensor = tiles.get(mkSensorTileId(MicroBitV2HostActions.RadioReceiveNumber.key));
  const stringSensor = tiles.get(mkSensorTileId(MicroBitV2HostActions.RadioReceiveString.key));
  const numberValueTile = tiles.get(mkOutputTileId(CoreTypeIds.Number, "value"));
  const stringValueTile = tiles.get(mkOutputTileId(CoreTypeIds.String, "value"));
  assert.ok(sendTile);
  assert.ok(numberSensor);
  assert.ok(stringSensor);
  assert.ok(numberValueTile);
  assert.ok(stringValueTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${NAME} brain`);
  const page = brainDef.pages().get(0)!;

  const numberRule = page.children().get(0)!;
  numberRule.when().appendTile(numberSensor);
  numberRule.do().appendTile(sendTile);
  numberRule.do().appendTile(numberValueTile);

  const stringRule = page.appendNewRule()!;
  stringRule.when().appendTile(stringSensor);
  stringRule.do().appendTile(sendTile);
  stringRule.do().appendTile(stringValueTile);

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

function ensureJsonGolden(jsonPath: string): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

function runTrace(bin: Uint8Array): { trace: string; sends: RadioSendRecord[] } {
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
  const sends: RadioSendRecord[] = [];
  const deviceSend = microbit.radio.send.bind(microbit.radio);
  microbit.radio.send = (record) => {
    writer.radioSend(record);
    sends.push(record);
    return deviceSend(record);
  };

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of SCHEDULE.entries()) {
    for (const packet of step.inject ?? []) {
      microbit.radio.deliver(packet);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), sends };
}

test("the committed two-provider radio-output binary and observable trace golden are byte-stable", () => {
  const jsonPath = fixturePath("mcprogram");
  const binPath = fixturePath("mcprogram.bin");
  const tracePath = fixturePath("ticks.trace");

  ensureJsonGolden(jsonPath);
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (!existsSync(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${NAME}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // Both providers fire on the delivering think, so two packets are sent.
  assert.equal(lines.filter((line) => line.startsWith("port radio send ")).length, 2);

  // Each provider's own value output reaches its own send, with no leak: the set
  // of sent packets is exactly the injected number and the injected string.
  assert.equal(first.sends.length, 2);
  const numberSend = first.sends.find((record) => record.type === RadioPacketType.Number);
  const stringSend = first.sends.find((record) => record.type === RadioPacketType.String);
  assert.ok(numberSend, "the number provider must send its value");
  assert.ok(stringSend, "the string provider must send its value");
  assert.equal(numberSend.value, NUMBER_VALUE);
  assert.equal(stringSend.text, STRING_VALUE);

  if (!existsSync(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${NAME}.ticks.trace is not byte-stable`);
});
