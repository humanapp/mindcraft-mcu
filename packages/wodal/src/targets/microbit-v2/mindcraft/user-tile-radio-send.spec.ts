/**
 * Golden for the TS user-code radio send surface (`ctx.microbit.radio`): a
 * user-tile brain whose actuator sends one of each framed packet form plus a
 * raw datagram, exercising the wire-type selection (integer NUMBER vs
 * non-integer DOUBLE, VALUE name+number) and the `port radio send` trace
 * rendering. The serialized binary and the rendered trace are pinned beside
 * this spec; the C++ VM parity test loads the same binary, replays the
 * schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
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

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-radio-send.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-radio-send.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-radio-send.ticks.trace", import.meta.url));

const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-radio-send",
  onExecute(ctx: Context): void {
    ctx.microbit.radio.sendNumber(42);
    ctx.microbit.radio.sendNumber(3.5);
    ctx.microbit.radio.sendString("hi");
    ctx.microbit.radio.sendValue("x", 7);
    ctx.microbit.radio.sendBuffer(Buffer.fromHex("aabbcc"));
    ctx.microbit.radio.sendRawBuffer(Buffer.fromHex("0102"));
  },
});
`;

const SCHEDULE: readonly number[] = [16];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.codal.d.ts", content: readText("../../../../ambient/mindcraft.codal.d.ts") },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-radio-send.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile radio send brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(findBundleTile(bundle.tiles, "sensor"));
  rule.do().appendTile(findBundleTile(bundle.tiles, "actuator"));

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
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

test("the committed user-tile radio-send binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-radio-send.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("port radio send ")).length, SCHEDULE.length * 6);
  assert.ok(lines.includes('port radio send group 0 string "hi"'));
  assert.ok(lines.includes("port radio send group 0 buffer aabbcc"));
  assert.ok(lines.includes("port radio send group 0 raw 0102"));

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first, "user-tile-radio-send.ticks.trace is not byte-stable");
});
