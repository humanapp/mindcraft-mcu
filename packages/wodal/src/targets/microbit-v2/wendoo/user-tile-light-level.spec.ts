/**
 * Golden for the TS user-code light-level surface
 * (`ctx.microbit.display.getLightLevel()`): a user-tile brain whose actuator reads
 * the ambient light level and writes it to a display pixel, exercising the
 * Device-API method on surface 2. The serialized binary and the rendered trace are
 * pinned beside this spec; the C++ VM parity test (cpp/test/trace-parity.test.cpp)
 * loads the same binary, replays the schedule, and byte-compares - confirming the
 * host-function read agrees across VMs.
 *
 * The scripted schedule covers two distinct light values and a tick that sets
 * nothing (the reading holds), each within 0..255 so it survives the display
 * port's uint8 brightness narrowing identically on both VMs.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { WendooEnvironment } from "@wendoo-lang/core/app";
import type { IBrainTileDef } from "@wendoo-lang/core/brain";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@wendoo-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@wendoo-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@wendoo-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-light-level.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-light-level.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-light-level.ticks.trace", import.meta.url));

// A trigger that fires every think (the light level is always >= 0), so the
// actuator runs each tick regardless of the injected level.
const SENSOR_SOURCE = `import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.display.getLightLevel() >= 0;
  },
});
`;

// Reads the ambient light level and writes it to pixel (0,0), surfacing the
// Device-API read through the display port.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "wendoo";

export default Actuator({
  name: "user-show-light-level",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(0, 0, ctx.microbit.display.getLightLevel());
  },
});
`;

/** One scheduled think: the injected light level, or undefined to hold the last value. */
interface ScheduleStep {
  readonly advanceMs: number;
  readonly lightLevel?: number;
}

// Two distinct light values plus a hold tick (sets nothing, proving the reading
// holds); the final tick holds 40.
const SCHEDULE: readonly ScheduleStep[] = [
  { advanceMs: 16, lightLevel: 200 },
  { advanceMs: 16, lightLevel: 40 },
  { advanceMs: 16 },
];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "wendoo.core.d.ts",
      content: readText("../../../../../../external/wendoo-lang/packages/core/lib/wendoo.core.d.ts"),
    },
    { path: "wendoo.codal.d.ts", content: readText("../../../../lib/wendoo.codal.d.ts") },
    {
      path: "wendoo.microbit-v2.d.ts",
      content: readText("../../../../targets/microbit-v2/lib/wendoo.microbit-v2.d.ts"),
    },
  ];
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> show-light-level image. */
function buildImage(environment: WendooEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-show-light-level.ts", ACTUATOR_SOURCE],
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile light level brain");
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

/** Runs the committed binary over the schedule with the display-port tap installed. */
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

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, step] of SCHEDULE.entries()) {
    if (step.lightLevel !== undefined) {
      microbit.setLightLevel(step.lightLevel);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile light-level binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (shouldWriteGolden(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "user-tile-light-level.mcprogram.bin is not byte-stable");

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // One pixel write per think (the light-level read), no host-action lines, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // The final think holds 40 at pixel (0,0).
  assert.equal(first.microbit.display.getPixelValue(0, 0), 40);

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "user-tile-light-level.ticks.trace is not byte-stable");
});
