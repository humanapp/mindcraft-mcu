/**
 * Golden for the TS user-code draw API (`ctx.microbit.display.drawImage`): a
 * user-tile brain whose async actuator builds an `Image` inline (a `Buffer.from`
 * pixel buffer in a struct literal) and awaits `drawImage`, the first asynchronous
 * `ctx.microbit.*` host function (op 41 `HOST_CALL_ASYNC`). Two fixtures pin the
 * display-lease behavior reached through the host-function path:
 *
 * - timed: a positive-duration draw holds the display lease for its duration; the
 *   actuator parks on the awaited handle and resumes on the first think past the
 *   hold, then lights a marker pixel through `setPixelValue`.
 * - fire-and-forget: an explicit zero-duration draw paints, takes no lease, and
 *   resolves at dispatch; the actuator continues in the same think and lights its
 *   marker pixel without ever parking.
 *
 * The rule fires once on page entry (the core `on page entered` host sensor); its
 * `do` is the compiled async actuator, whose `drawImage` / `setPixelValue` cross
 * the display port as host functions, which carry no host-action dispatch line.
 * The serialized binary and the rendered trace are pinned beside this spec; the
 * C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary,
 * replays the schedule, and byte-compares.
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
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";

const ON_PAGE_ENTERED = CoreHostActions.OnPageEntered.actionId;

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 100;

/** Hold of the timed fixture, in seconds, passed as the `drawImage` duration argument. */
const HOLD_SECONDS = 0.25;

/** Trace hex of the drawn 5x5 image (top row lit, the rest dark), row-major brightness bytes. */
const TOP_ROW_HEX = `ffffffffff${"00".repeat(20)}`;

/**
 * Source of an async actuator that builds a 5x5 `Image` whose top row is lit,
 * draws it for `durationLiteral` seconds, then lights pixel (4,4) once the draw
 * resolves. With a positive duration the actuator parks until the hold elapses;
 * with an explicit `0` it continues in the same think.
 */
function actuatorSource(name: string, durationLiteral: string): string {
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
    await ctx.microbit.display.drawImage(image, ${durationLiteral});
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
      path: "mindcraft.core.d.ts",
      content: readText("../../../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function findActuatorTile(tiles: readonly IBrainTileDef[]): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === "actuator");
  assert.ok(tile);
  return tile;
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Compiles the async draw actuator, installs it, and builds a single-page brain
 * whose rule fires on page entry (the core `on page entered` sensor) and runs the
 * actuator.
 */
function buildImage(
  environment: MindcraftEnvironment,
  actuatorName: string,
  durationLiteral: string
): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(new Map([[`${actuatorName}.ts`, actuatorSource(actuatorName, durationLiteral)]]));
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile draw brain");
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
function ensureJsonGolden(jsonPath: string, actuatorName: string, durationLiteral: string): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment, actuatorName, durationLiteral);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/**
 * Runs the committed binary over `tickCount` thinks at {@link TICK_ADVANCE_MS}
 * each with the trace taps installed: the on-page-entered host sensor (its async
 * actuator draws and writes through host functions, which carry no host-action
 * dispatch line) plus the display draw / set-pixel ports. The draw port line is
 * emitted only when the display is free, and the display poll runs after each
 * think so a timed draw's hold settles and the awaiting fiber resumes.
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

  const actions = environment.brainServices.runtime.actions;
  const onPageEntered = actions.getById(ON_PAGE_ENTERED);
  assert.ok(onPageEntered !== undefined && onPageEntered.binding === "host");
  const onPageEnteredExec = onPageEntered.execSync;
  assert.ok(onPageEnteredExec !== undefined);
  onPageEntered.execSync = (ctx, args) => {
    const result = onPageEnteredExec(ctx, args);
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    writer.hostActionCall(ON_PAGE_ENTERED, callSiteId, args, result);
    return result;
  };

  const microbit = new MicroBit();
  const deviceDrawImage = microbit.display.drawImage.bind(microbit.display);
  microbit.display.drawImage = (frame, width, height, durationMs, requestTime, onComplete) => {
    if (!microbit.display.isBusy()) {
      writer.displayDraw(width, height, frame);
    }
    deviceDrawImage(frame, width, height, durationMs, requestTime, onComplete);
  };
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };

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
 * Pins the `.mcprogram` / `.mcprogram.bin` / `.ticks.trace` golden for a draw
 * actuator: the JSON freezes the brain's generated page id, the bytes are
 * byte-stable across builds, two fresh runs render identical traces, and the
 * rendered trace matches the committed golden.
 */
function runDrawFixture(name: string, actuatorName: string, durationLiteral: string, tickCount: number): string {
  const jsonPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram`, import.meta.url));
  const binPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${name}.ticks.trace`, import.meta.url));

  ensureJsonGolden(jsonPath, actuatorName, durationLiteral);
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (!existsSync(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${name}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin, tickCount);
  const second = runTrace(bin, tickCount);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  if (!existsSync(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${name}.ticks.trace is not byte-stable`);
  return first.trace;
}

test("a user-tile timed drawImage holds the display, parks, and resumes", () => {
  // 100ms thinks: the 250ms hold (dispatched at think 1, time 100) completes at
  // 350, is resolved by the think-4 poll, and the actuator resumes on think 5.
  const resumeTick = Math.floor((TICK_ADVANCE_MS + HOLD_SECONDS * 1000) / TICK_ADVANCE_MS) + 2;
  const trace = runDrawFixture("user-tile-draw-timed", "user-draw-timed", `${HOLD_SECONDS}`, resumeTick);
  const result = runTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/user-tile-draw-timed.mcprogram.bin", import.meta.url)))
    ),
    resumeTick
  );
  const lines = trace.split("\n");
  // One paste at dispatch; the marker pixel only after the hold resolves.
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${TOP_ROW_HEX}`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  // The async draw is a host function (op 41), so it carries no `action ... async` line.
  assert.equal(lines.filter((line) => line.endsWith(" async")).length, 0);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("a user-tile fire-and-forget drawImage paints and continues in the same think", () => {
  const trace = runDrawFixture("user-tile-draw-forget", "user-draw-forget", "0", 2);
  const result = runTrace(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL("./__fixtures__/user-tile-draw-forget.mcprogram.bin", import.meta.url)))
    ),
    2
  );
  const lines = trace.split("\n");
  // The draw and the marker pixel both land on the same think (no park).
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${TOP_ROW_HEX}`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(lines.filter((line) => line.endsWith(" async")).length, 0);
  assert.equal(result.microbit.display.getPixelValue(4, 4), 255);
  assert.equal(result.microbit.display.getPixelValue(0, 0), 255);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
});

test("drawImage's duration argument is optional: omitting it typechecks and compiles", () => {
  const environment = createMicroBitV2Environment();
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  const source = `import { Actuator, type Context, type Image } from "mindcraft";

export default Actuator({
  name: "user-draw-default-duration",
  async onExecute(ctx: Context): Promise<void> {
    const image: Image = { width: 1, height: 1, pixels: Buffer.from([255]) };
    await ctx.microbit.display.drawImage(image);
  },
});
`;
  project.setFiles(new Map([["user-draw-default-duration.ts", source]]));
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  for (const [path, result] of compileResult.results) {
    assert.deepEqual(result.diagnostics, [], `Unexpected compiler diagnostics for ${path}`);
    assert.ok(result.program, `Expected a compiled program for ${path}`);
  }
});
