/**
 * Golden observable trace for a conversion filling the `radio send` tile's
 * choice value slot: an inline user sensor returning a user-declared position
 * struct sits directly in the send slot, and the registered position -> Buffer
 * conversion encodes it as the three-byte state packet `[0x47, x+100, y+100]`.
 * The brain pairs the button sensor in the rule's when() with
 * `[radio send [position reading]]` in its do(), driven by a scripted button
 * schedule. The serialized binary and the rendered trace are pinned beside
 * this spec as the cross-VM conformance fixtures; the C++ VM parity test loads
 * the binary, replays the same schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type MindcraftEnvironment, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/radio-send-position.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/radio-send-position.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/radio-send-position.ticks.trace", import.meta.url));

const POSITION_SOURCE = `import { NumberType, type StructOf, StructType } from "mindcraft";

export const Position = StructType({
  name: "position",
  fields: { x: NumberType, y: NumberType },
});

export type Position = StructOf<typeof Position>;
`;

const CONVERSION_SOURCE = `import { BufferType, Conversion } from "mindcraft";
import { Position } from "./position";

export default Conversion({
  from: Position,
  to: BufferType,
  cost: 2,
  convert(pos: Position): Buffer {
    return Buffer.from([0x47, pos.x + 100, pos.y + 100]);
  },
});
`;

const SENSOR_SOURCE = `import { type Context, Sensor } from "mindcraft";
import { Position } from "./position";

export default Sensor({
  name: "position reading",
  returnType: Position,
  inline: true,
  onExecute(ctx: Context): Position {
    return Position({ x: 50, y: -25 });
  },
});
`;

/** Button A pressed at tick 2, released at tick 3. */
const SCHEDULE: readonly { advanceMs: number; a?: boolean }[] = [
  { advanceMs: 16 },
  { advanceMs: 16, a: true },
  { advanceMs: 16, a: false },
];

/** The encoded state packet for the fixed (50, -25) position. */
const PACKET_HEX = "47964b";

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

function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["position.ts", POSITION_SOURCE],
      ["position-to-buffer.ts", CONVERSION_SOURCE],
      ["position-reading.ts", SENSOR_SOURCE],
    ])
  );
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const tiles = environment.brainServices.edit.tiles;
  const buttonTile = tiles.get(mkSensorTileId(MicroBitV2HostActions.ButtonA.key));
  const sendTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.RadioSend.key));
  const positionTile = bundle.tiles.find((tile: IBrainTileDef) => tile.metadata?.label === "position reading");
  assert.ok(buttonTile);
  assert.ok(sendTile);
  assert.ok(positionTile);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "radio send position brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(buttonTile);
  rule.do().appendTile(sendTile);
  rule.do().appendTile(positionTile);

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

function runTrace(bin: Uint8Array): string {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const actions = environment.brainServices.runtime.actions;
  for (const { actionId } of [MicroBitV2HostActions.ButtonA, MicroBitV2HostActions.RadioSend]) {
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

test("the committed radio-send-position binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "radio-send-position.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(
    lines.filter((line) => line === `port radio send group 0 buffer ${PACKET_HEX}`).length,
    1,
    "the press tick transmits the converted position packet exactly once"
  );

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "radio-send-position.ticks.trace is not byte-stable");
});
