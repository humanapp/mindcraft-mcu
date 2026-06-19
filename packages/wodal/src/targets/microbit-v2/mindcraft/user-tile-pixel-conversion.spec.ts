/**
 * Golden for the TS user-code display surface narrowing
 * (`ctx.microbit.display.setPixelValue`): a user-tile brain whose actuator writes
 * fractional, negative, over-range, and out-of-matrix values to pixels. The host
 * function narrows each argument to CODAL's int16 coordinate / uint8 brightness
 * before it crosses the display port (per docs/specs/contracts/observable-trace.md),
 * so the recorded `port display set-pixel` line carries the post-narrowing value
 * and byte-matches the C++ VM parity test (cpp/test/trace-parity.test.cpp).
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
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-pixel-conversion.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-pixel-conversion.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-pixel-conversion.ticks.trace", import.meta.url));

// A trigger that fires every think, so the actuator runs each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Writes values that each narrow non-trivially: a fractional brightness, another
// fractional brightness, an over-range brightness (wraps), a negative brightness
// (wraps), a fractional coordinate (truncates), and an out-of-matrix coordinate
// (crosses the port but stores nothing).
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-narrow-pixels",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(0, 0, 0.5);
    ctx.microbit.display.setPixelValue(1, 0, 7.9);
    ctx.microbit.display.setPixelValue(2, 0, 300);
    ctx.microbit.display.setPixelValue(3, 0, -30);
    ctx.microbit.display.setPixelValue(1.9, 1, 5);
    ctx.microbit.display.setPixelValue(9, 1, 5);
  },
});
`;

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> narrow-pixels image. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-narrow-pixels.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile pixel conversion brain");
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

/** Runs the committed binary for one think with the display-port tap installed. */
function runTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  writer.tick(1, 16, 0);
  runtime.tick(16);
  return { trace: writer.render(), microbit };
}

test("the committed user-tile pixel-conversion binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-pixel-conversion.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  // Six pixel writes (one per setPixelValue call), no host-action lines, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 6);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // Stored values reflect the narrowing: 7.9 -> 7, 300 -> 44, -30 -> 226, the
  // fractional coordinate 1.9 -> column 1; the out-of-matrix coordinate stores nothing.
  assert.equal(first.microbit.display.getPixelValue(1, 0), 7);
  assert.equal(first.microbit.display.getPixelValue(2, 0), 44);
  assert.equal(first.microbit.display.getPixelValue(3, 0), 226);
  assert.equal(first.microbit.display.getPixelValue(1, 1), 5);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(TRACE_PATH, "utf8"),
    first.trace,
    "user-tile-pixel-conversion.ticks.trace is not byte-stable"
  );
});
