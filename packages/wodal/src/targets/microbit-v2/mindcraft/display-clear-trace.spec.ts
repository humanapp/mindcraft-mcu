/**
 * Goldens for `ctx.microbit.display.clear()` (the synchronous device-API clear
 * host function). Two fixtures pin its observable behavior, both byte-matched by
 * the C++ VM parity test (cpp/test/trace-parity.test.cpp):
 *
 * - bare: a lone `clear()` on page entry emits `port display clear`; with no
 *   lease held the cancel is a no-op and only the clear line crosses the port.
 * - preempts: rule 0 takes a timed display lease (a 0.25 s `drawImage`) and
 *   parks; rule 1, running next in the same think, calls `clear()`. The clear
 *   preempts rule 0's lease (resolving its handle so it resumes next think),
 *   blanks the matrix, and emits `port display clear`, then lights pixel (0,4).
 *   Rule 0 resumes on the next think and lights pixel (4,4), proving the parked
 *   fiber was released.
 *
 * Each actuator is compiled from TS user code; `clear()` and `setPixelValue`
 * cross the display port as synchronous host functions and `drawImage` as the
 * asynchronous op-41 host function, none of which carry a host-action dispatch
 * line. The serialized binary and rendered trace are pinned beside this spec.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CoreHostActions, type MindcraftEnvironment, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainRuntime,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  type PlatformServices,
} from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 100;

/** Trace hex of the drawn 5x5 image (top row lit, the rest dark), row-major brightness bytes. */
const TOP_ROW_HEX = `ffffffffff${"00".repeat(20)}`;

/** One compiled actuator placed in its own rule, keyed by the actuator's display name. */
interface ActuatorSpec {
  /** The actuator's `name:`, used to recover its tile from the bundle. */
  readonly name: string;

  /** TS user-code source of the actuator module. */
  readonly source: string;
}

/** Source of an actuator that clears the display once on page entry. */
function bareClearSource(name: string): string {
  return `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "${name}",
  async onExecute(ctx: Context): Promise<void> {
    ctx.microbit.display.clear();
  },
});
`;
}

/**
 * Source of an actuator that draws a top-row `Image` for a positive duration,
 * parks on the awaited handle, then lights pixel (4,4) once it resolves.
 */
function timedDrawSource(name: string): string {
  return `import { Actuator, type Context, type Image } from "mindcraft";

export default Actuator({
  name: "${name}",
  async onExecute(ctx: Context): Promise<void> {
    const image: Image = {
      width: 5,
      height: 5,
      pixels: Buffer.from([
        255, 255, 255, 255, 255,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0, 0, 0, 0,
      ]),
    };
    await ctx.microbit.display.drawImage(image, { duration: 0.25 });
    ctx.microbit.display.setPixelValue(4, 4, 255);
  },
});
`;
}

/** Source of an actuator that clears the display, then lights pixel (0,4). */
function clearMarkerSource(name: string): string {
  return `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "${name}",
  async onExecute(ctx: Context): Promise<void> {
    ctx.microbit.display.clear();
    ctx.microbit.display.setPixelValue(0, 4, 255);
  },
});
`;
}

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

function findActuatorByName(tiles: readonly IBrainTileDef[], name: string): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === "actuator" && candidate.metadata?.label === name);
  assert.ok(tile, `actuator tile "${name}" should be present in the compiled bundle`);
  return tile;
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Compiles every actuator into one bundle, installs it, and builds a single-page
 * brain with one rule per actuator (in order), each firing on page entry (the
 * core `on page entered` sensor).
 */
function buildImage(
  environment: MindcraftEnvironment,
  actuators: readonly ActuatorSpec[]
): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(new Map(actuators.map((actuator) => [`${actuator.name}.ts`, actuator.source])));
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const onPageEntered = environment.brainServices.edit.tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  assert.ok(onPageEntered, "on page entered sensor tile should be registered");

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile clear brain");
  const page = brainDef.pages().get(0)!;
  for (let i = 0; i < actuators.length; i++) {
    const rule = i === 0 ? page.children().get(0) : page.appendNewRule();
    assert.ok(rule);
    rule.when().appendTile(onPageEntered);
    rule.do().appendTile(findActuatorByName(bundle.tiles, actuators[i]!.name));
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

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated id. */
function ensureJsonGolden(jsonPath: string, actuators: readonly ActuatorSpec[]): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment, actuators);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/**
 * Runs the committed binary over `tickCount` thinks at {@link TICK_ADVANCE_MS}
 * each with the trace observers installed: the on-page-entered host sensor plus the
 * display draw / set-pixel / clear ports (the actuators' `drawImage`,
 * `setPixelValue`, and `clear` are host functions, which carry no host-action
 * dispatch line). The display poll runs after each think so a timed draw's hold
 * settles and the awaiting fiber resumes.
 */
function runTrace(bin: Uint8Array, tickCount: number): { trace: string; microbit: MicroBit } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const microbit = new MicroBit();
  const devicePaintFrame = microbit.display.paintFrame.bind(microbit.display);
  microbit.display.paintFrame = (image) => {
    writer.displayDraw(image.width, image.height, image.frame);
    devicePaintFrame(image);
  };
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };
  const deviceClear = microbit.display.clear.bind(microbit.display);
  microbit.display.clear = () => {
    writer.displayClear();
    deviceClear();
  };

  const vmEvents = observableTraceVmEvents(writer);

  const linked = decoded.program;
  const brain = new BrainRuntime(
    linked.program,
    linked.pages,
    hostServicesOf(environment),
    { microbit },
    undefined,
    vmEvents,
    {
      defaultBudget: profile.defaultBudget,
      hookBudget: profile.hookBudget,
      maxFibers: profile.maxFibers,
      maxStackSize: profile.maxStackSize,
      maxLocalsSize: profile.maxLocalsSize,
      maxFrameDepth: profile.maxFrameDepth,
      maxHandlers: profile.maxHandlers,
    }
  );
  brain.startup();

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + TICK_ADVANCE_MS;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    brain.think(timeMs);
    microbit.display.advanceScroll(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

/**
 * Pins the `.mcprogram` / `.mcprogram.bin` / `.ticks.trace` golden: the JSON
 * freezes the brain's generated page id, the bytes are byte-stable across builds,
 * two fresh runs render identical traces, and the rendered trace matches the
 * committed golden.
 */
function runClearFixture(
  name: string,
  actuators: readonly ActuatorSpec[],
  tickCount: number
): {
  trace: string;
  microbit: MicroBit;
} {
  const jsonPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram`, import.meta.url));
  const binPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${name}.ticks.trace`, import.meta.url));

  ensureJsonGolden(jsonPath, actuators);
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (shouldWriteGolden(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${name}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin, tickCount);
  const second = runTrace(bin, tickCount);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  if (shouldWriteGolden(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${name}.ticks.trace is not byte-stable`);
  return first;
}

test("a bare display.clear() emits one port display clear", () => {
  const result = runClearFixture(
    "user-tile-display-clear",
    [{ name: "user-display-clear", source: bareClearSource("user-display-clear") }],
    2
  );
  const lines = result.trace.split("\n");
  assert.equal(lines.filter((line) => line === "port display clear").length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display draw ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 0);
  assert.equal(lines.filter((line) => line.endsWith(" async")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("clear() preempts a held draw, releasing the parked fiber and blanking the matrix", () => {
  const result = runClearFixture(
    "display-clear-preempts",
    [
      { name: "user-clear-holder", source: timedDrawSource("user-clear-holder") },
      { name: "user-clear-preemptor", source: clearMarkerSource("user-clear-preemptor") },
    ],
    3
  );
  const lines = result.trace.split("\n");
  // The holder pasted the top row once before being preempted.
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${TOP_ROW_HEX}`).length, 1);
  // Exactly one clear crosses the port, cancelling the held lease.
  assert.equal(lines.filter((line) => line === "port display clear").length, 1);
  // The preemptor's marker (0,4) and the released holder's marker (4,4) both land.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  assert.equal(lines.filter((line) => line.endsWith(" async")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // clear() zeroed the top row; the two markers are the only lit pixels.
  assert.equal(result.microbit.display.getPixelValue(0, 0), 0);
  assert.equal(result.microbit.display.getPixelValue(0, 4), 255);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
});
