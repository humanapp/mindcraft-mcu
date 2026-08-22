/**
 * Goldens for the TS user-code scroll API (`ctx.microbit.display.scrollText`):
 * a user-tile brain whose async actuator awaits `scrollText`, the asynchronous
 * `ctx.microbit.*` host function (op 41 `HOST_CALL_ASYNC`) over the same
 * display facade the display-text tile action drives. Two fixtures pin the
 * behavior reached through the host-function path:
 *
 * - awaited: a multi-character text takes the display lease and scrolls for the
 *   pinned duration formula (`scrollDurationMs`); the actuator parks on the
 *   awaited handle and resumes on the first think past completion, then lights
 *   a marker pixel through `setPixelValue`.
 * - glyph: a one-character text is a static show -- its glyph is painted at
 *   once, holds the display for the duration the scroll formula gives one
 *   character, and the display blanks at completion; the actuator parks and
 *   resumes the same way.
 *
 * The rule fires once on page entry (the core `on page entered` host sensor);
 * its `do` is the compiled async actuator, whose `scrollText` / `setPixelValue`
 * cross the display port as host functions, which carry no host-action dispatch
 * line. The serialized binary and the rendered trace are pinned beside this
 * spec; the C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same
 * binary, replays the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CoreHostActions, mkSensorTileId, type WendooEnvironment } from "@wendoo-lang/core/app";
import type { IBrainTileDef } from "@wendoo-lang/core/brain";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import {
  BrainRuntime,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  type PlatformServices,
} from "@wendoo-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@wendoo-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@wendoo-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { SCROLL_DEFAULT_DELAY_MS, scrollCompletionTimeMs } from "./display-scroll";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;

/**
 * Source of an async actuator that awaits `scrollText(text)` and lights pixel
 * (4,4) once the show completes. The await parks the actuator for the show's
 * full pinned duration.
 */
function actuatorSource(name: string, textLiteral: string): string {
  return `import { Actuator, type Context } from "wendoo";

export default Actuator({
  name: "${name}",
  async onExecute(ctx: Context): Promise<void> {
    await ctx.microbit.display.scrollText(${JSON.stringify(textLiteral)});
    ctx.microbit.display.setPixelValue(4, 4, 255);
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

function findActuatorTile(tiles: readonly IBrainTileDef[]): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === "actuator");
  assert.ok(tile);
  return tile;
}

function hostServicesOf(environment: WendooEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Compiles the async scroll actuator, installs it, and builds a single-page
 * brain whose rule fires on page entry (the core `on page entered` sensor) and
 * runs the actuator.
 */
function buildImage(
  environment: WendooEnvironment,
  actuatorName: string,
  source: string
): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(new Map([[`${actuatorName}.ts`, source]]));
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile scroll brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(onPageEntered);
  rule.do().appendTile(findActuatorTile(bundle.tiles));

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
function ensureJsonGolden(jsonPath: string, actuatorName: string, source: string): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment, actuatorName, source);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/**
 * Runs the committed binary over `tickCount` thinks at {@link TICK_ADVANCE_MS}
 * each with the trace observers installed: the on-page-entered host sensor (its
 * async actuator scrolls and writes through host functions, which carry no
 * host-action dispatch line) plus the display scroll / set-pixel ports. The
 * scroll port line is emitted only when the display is free, and the display
 * poll runs after each think so a completed show settles and the awaiting
 * fiber resumes.
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
  const deviceScrollText = microbit.display.scrollText.bind(microbit.display);
  microbit.display.scrollText = (text, durationMs, requestTime, onComplete) => {
    // A scroll dropped while the display is busy crosses no port and emits no line.
    if (!microbit.display.isBusy()) {
      writer.displayScroll(text);
    }
    deviceScrollText(text, durationMs, requestTime, onComplete);
  };
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
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
 * Pins the `.mcprogram` / `.mcprogram.bin` / `.ticks.trace` golden for a scroll
 * actuator: the JSON freezes the brain's generated page id, the bytes are
 * byte-stable across builds, two fresh runs render identical traces, and the
 * rendered trace matches the committed golden.
 */
function runScrollFixture(name: string, actuatorName: string, source: string, tickCount: number): string {
  const jsonPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram`, import.meta.url));
  const binPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${name}.ticks.trace`, import.meta.url));

  ensureJsonGolden(jsonPath, actuatorName, source);
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
  return first.trace;
}

/**
 * The tick on which an awaited show of `text` resumes its actuator: the show
 * starts on tick 1, completes one pinned duration later, is settled by the poll
 * of the first think at or past completion, and the fiber resumes on the think
 * after that.
 */
function resumeTickFor(text: string): number {
  const completionTime = scrollCompletionTimeMs(TICK_ADVANCE_MS, text.length, SCROLL_DEFAULT_DELAY_MS);
  return Math.floor(completionTime / TICK_ADVANCE_MS) + 2;
}

test("a user-tile awaited scrollText holds the display, parks, and resumes", () => {
  const text = "hi";
  const tickCount = resumeTickFor(text);
  const trace = runScrollFixture(
    "user-tile-scroll-awaited",
    "user-scroll-awaited",
    actuatorSource("user-scroll-awaited", text),
    tickCount
  );
  const result = runTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/user-tile-scroll-awaited.mcprogram.bin", import.meta.url)))
    ),
    tickCount
  );
  const lines = trace.split("\n");
  // One scroll crosses the port; the marker pixel only after the show resolves.
  assert.equal(lines.filter((line) => line === `port display scroll "${text}"`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  // The async scroll is a host function (op 41), so it carries no `action ... async` line.
  assert.equal(lines.filter((line) => line.startsWith("action ") && line.endsWith(" async")).length, 0);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("a user-tile one-character scrollText shows a static glyph, holds, and blanks", () => {
  const text = "A";
  const tickCount = resumeTickFor(text);
  const trace = runScrollFixture(
    "user-tile-scroll-glyph",
    "user-scroll-glyph",
    actuatorSource("user-scroll-glyph", text),
    tickCount
  );
  const result = runTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/user-tile-scroll-glyph.mcprogram.bin", import.meta.url)))
    ),
    tickCount
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === `port display scroll "${text}"`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  // The async scroll is a host function (op 41), so it carries no `action ... async` line.
  assert.equal(lines.filter((line) => line.startsWith("action ") && line.endsWith(" async")).length, 0);
  // The show blanked the glyph at completion; the marker is the only lit pixel.
  assert.equal(result.microbit.display.getPixelValue(2, 2), 0);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});
