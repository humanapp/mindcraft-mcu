/**
 * Golden for the optional-arg presence guard: a user sensor with an optional
 * anonymous buffer arg whose onExecute opens with the defensive decoder guard
 * `if (!b || b.length() < 3 || b.get(0) !== PACKET_MAGIC) return undefined;`.
 * The brain exercises both invocations of the same tile: one rule leaves the
 * arg slot empty, so onExecute receives nil, the guard returns undefined, and
 * the WHEN holds false; the other fills the slot with a buffer literal
 * [42, 7, 9], so the guard passes and the decoded payload (7*256+9) flows as
 * the rule's WHEN-result into a bare `radio send`. The serialized binary and
 * the rendered trace are pinned beside this spec; the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the
 * schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import {
  CoreTypeIds,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  mkActuatorTileId,
  mkBufferValueFromHex,
  mkNumberValue,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions } from "./tile-ids";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-presence-guard.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-presence-guard.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-presence-guard.ticks.trace", import.meta.url));

/** Packet bytes placed in the guarded rule's slot: [PACKET_MAGIC, 7, 9]. */
const PACKET_HEX = "2a0709";

/** Decoded payload of PACKET_HEX: byte 1 * 256 + byte 2. */
const DECODED_VALUE = 7 * 256 + 9;

/** Sentinel the never-firing bare rule would radio-send if its guard leaked. */
const ABSENT_SENTINEL = 9999;

// The tile under test: an optional buffer arg presence-guarded in user code.
const SENSOR_SOURCE = `import { Sensor, type Context, optional, param } from "mindcraft";

const PACKET_MAGIC = 42;

export default Sensor({
  name: "packet-decode",
  args: [optional(param("packet", { type: "buffer", anonymous: true }))],
  onExecute(ctx: Context, args: { packet?: Buffer }): number | undefined {
    const b = args.packet;
    if (!b || b.length() < 3 || b.get(0) !== PACKET_MAGIC) {
      return undefined;
    }
    return b.get(1) * 256 + b.get(2);
  },
});
`;

/** Two scheduled thinks: only the time advance (the brain reads no input). */
const SCHEDULE: readonly number[] = [16, 16];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/lib/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.codal.d.ts", content: readText("../../../../lib/mindcraft.codal.d.ts") },
    {
      path: "mindcraft.microbit-v2.d.ts",
      content: readText("../../../../targets/microbit-v2/lib/mindcraft.microbit-v2.d.ts"),
    },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/**
 * Compiles the decoder, installs the bundle, and builds the two-rule brain:
 * rule 0 with the arg slot empty, rule 1 with the packet buffer literal.
 */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(new Map([["packet-decode.ts", SENSOR_SOURCE]]));
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  for (const [path, entry] of compileResult.results) {
    assert.deepEqual(entry.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry.diagnostics)}`);
  }
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const decoderTile = findBundleTile(bundle.tiles, "sensor");
  const sendTile = environment.brainServices.edit.tiles.get(mkActuatorTileId(MicroBitV2HostActions.RadioSend.key));
  assert.ok(sendTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "presence-guard brain");
  const page = brainDef.pages().get(0)!;

  const absentRule = page.children().get(0)!;
  absentRule.when().appendTile(decoderTile);
  absentRule.do().appendTile(sendTile);
  absentRule
    .do()
    .appendTile(
      new BrainTileLiteralDef(
        CoreTypeIds.Number,
        mkNumberValue(ABSENT_SENTINEL),
        { valueLabel: String(ABSENT_SENTINEL), persist: true },
        environment.brainServices
      )
    );

  const packetRule = page.appendNewRule()!;
  packetRule.when().appendTile(decoderTile);
  packetRule
    .when()
    .appendTile(
      new BrainTileLiteralDef(
        CoreTypeIds.Buffer,
        mkBufferValueFromHex(PACKET_HEX),
        { valueLabel: PACKET_HEX, persist: true },
        environment.brainServices
      )
    );
  packetRule.do().appendTile(sendTile);

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

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated id. */
function ensureJsonGolden(): void {
  if (existsSync(JSON_PATH)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment);
  writeFileSync(
    JSON_PATH,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Runs the committed binary over the schedule with the radio-send taps installed. */
function runTrace(bin: Uint8Array): { trace: string; sentValues: number[] } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const actions = environment.brainServices.runtime.actions;
  const action = actions.getById(MicroBitV2HostActions.RadioSend.actionId);
  assert.ok(action !== undefined && action.binding === "host");
  const exec = action.execSync;
  assert.ok(exec !== undefined);
  action.execSync = (ctx, args) => {
    const result = exec(ctx, args);
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    writer.hostActionCall(MicroBitV2HostActions.RadioSend.actionId, callSiteId, args, result);
    return result;
  };

  const microbit = new MicroBit();
  const sentValues: number[] = [];
  const deviceSend = microbit.radio.send.bind(microbit.radio);
  microbit.radio.send = (record) => {
    writer.radioSend(record);
    sentValues.push(record.value);
    return deviceSend(record);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), sentValues };
}

test("the committed presence-guard binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-presence-guard.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // Each think sends exactly one packet: the guarded rule decoded [42, 7, 9]
  // into 7*256+9 and forwarded it as the WHEN-result. The complete send list
  // proves the bare rule (nil arg, sentinel payload) never fired.
  assert.equal(lines.filter((line) => line.startsWith("port radio send ")).length, SCHEDULE.length);
  assert.deepEqual(first.sentValues, [DECODED_VALUE, DECODED_VALUE]);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(TRACE_PATH, "utf8"),
    first.trace,
    "user-tile-presence-guard.ticks.trace is not byte-stable"
  );
});
