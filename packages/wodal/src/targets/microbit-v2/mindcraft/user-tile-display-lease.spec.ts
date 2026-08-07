/**
 * Goldens for the display lease flags of the TS user-code display API: the
 * optional `immediately` and `inBackground` booleans on
 * `ctx.microbit.display.drawImage` and `ctx.microbit.display.scrollText`, the
 * asynchronous `ctx.microbit.*` host functions (op 41 `HOST_CALL_ASYNC`) over
 * the same display facade the draw-image and display-text tile actions drive.
 * Four fixtures pin both flags reached through both methods:
 *
 * - draw-preempts-scroll: two root rules fire the same round. The first awaits
 *   `scrollText` and takes the display lease; the second draws with
 *   `immediately`, preempting the holder at dispatch. Both cross the display
 *   port on the dispatch tick, the preempted scroll's rule resumes well before
 *   its own scroll would complete, and the preemptor resumes after its own draw.
 * - scroll-preempts-draw: the mirror -- the first awaits `drawImage` and holds,
 *   the second scrolls with `immediately` and preempts.
 * - draw-background: a single `drawImage` with `inBackground` keeps its display
 *   lease but resolves at dispatch, so the issuing rule lights its marker the
 *   same round while the draw holds the lease for many more thinks.
 * - scroll-background: the same for `scrollText` with `inBackground`.
 *
 * Each rule fires on page entry (the core `on page entered` host sensor); each
 * `do` is a compiled async actuator whose `drawImage` / `scrollText` /
 * `setPixelValue` cross the display port as host functions, which carry no
 * host-action dispatch line. The serialized binary and the rendered trace are
 * pinned beside this spec; the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the schedule,
 * and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CoreHostActions, type MindcraftEnvironment, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
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
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { SCROLL_DEFAULT_DELAY_MS, scrollCompletionTimeMs } from "./display-scroll";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";

/**
 * Milliseconds advanced per scheduled think. Above every fixture's draw hold and
 * below the scroll holds, matching the play-sound goldens' policy of keeping op
 * durations off the tick boundary so no op settles within its own dispatch tick.
 */
const TICK_ADVANCE_MS = 500;

/** Trace hex of the drawn 5x5 image (top row lit, the rest dark), row-major brightness bytes. */
const TOP_ROW_HEX = `ffffffffff${"00".repeat(20)}`;

/** The two optional display-lease flags, defaulting false. */
interface LeaseFlags {
  /** Preempt the current display lease at dispatch and run now. */
  readonly immediately?: boolean;

  /** Resolve the call at dispatch so the caller continues without awaiting the hold. */
  readonly inBackground?: boolean;
}

/** The `immediately` / `inBackground` entries a lease-flag set contributes to an options struct literal. */
function leaseEntries(flags: LeaseFlags): string[] {
  const entries: string[] = [];
  if (flags.immediately) {
    entries.push("immediately: true");
  }
  if (flags.inBackground) {
    entries.push("inBackground: true");
  }
  return entries;
}

/**
 * Source of an async actuator that awaits a `drawImage` of a top-row-lit 5x5
 * image held for `durationSeconds` with the given lease flags and, when `marker`
 * is set, lights pixel (4,4) once the await resolves.
 */
function drawActuatorSource(name: string, durationSeconds: number, marker: boolean, flags: LeaseFlags = {}): string {
  const markerLine = marker ? "\n    ctx.microbit.display.setPixelValue(4, 4, 255);" : "";
  const options = `{ ${[`duration: ${durationSeconds}`, ...leaseEntries(flags)].join(", ")} }`;
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
    await ctx.microbit.display.drawImage(image, ${options});${markerLine}
  },
});
`;
}

/**
 * Source of an async actuator that awaits a `scrollText(text)` with the given
 * lease flags and, when `marker` is set, lights pixel (4,4) once the await
 * resolves.
 */
function scrollActuatorSource(name: string, text: string, marker: boolean, flags: LeaseFlags = {}): string {
  const markerLine = marker ? "\n    ctx.microbit.display.setPixelValue(4, 4, 255);" : "";
  const entries = leaseEntries(flags);
  const options = entries.length > 0 ? `, { ${entries.join(", ")} }` : "";
  return `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "${name}",
  async onExecute(ctx: Context): Promise<void> {
    await ctx.microbit.display.scrollText(${JSON.stringify(text)}${options});${markerLine}
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

/** The compiled actuator tile whose label is the given actuator name. */
function findActuatorTile(tiles: readonly IBrainTileDef[], name: string): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === "actuator" && candidate.metadata?.label === name);
  assert.ok(tile, `actuator tile '${name}' should be in the bundle`);
  return tile;
}

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Compiles the given actuator sources, installs them, and builds a single-page
 * brain whose rules each fire on page entry (the core `on page entered` sensor)
 * and run one actuator. With `structure: "siblings"` each actuator runs in its
 * own root rule, so all dispatch the same round and compete for the display
 * lease; with `structure: "single"` there is one rule.
 */
function buildImage(
  environment: MindcraftEnvironment,
  files: ReadonlyMap<string, string>,
  actuatorNames: readonly string[],
  structure: "single" | "siblings"
): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(new Map(files));
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile display-lease brain");
  const page = brainDef.pages().get(0)! as BrainPageDef;
  let rule = page.children().get(0)! as BrainRuleDef;
  rule.when().appendTile(onPageEntered);
  for (let i = 0; i < actuatorNames.length; i++) {
    if (i > 0) {
      assert.equal(structure, "siblings", "single-rule fixtures take one actuator");
      rule = page.appendNewRule() as BrainRuleDef;
      rule.when().appendTile(onPageEntered);
    }
    rule.do().appendTile(findActuatorTile(bundle.tiles, actuatorNames[i]!));
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

/**
 * Runs the committed binary over `tickCount` thinks at {@link TICK_ADVANCE_MS}
 * each with the trace observers installed: the on-page-entered host sensor plus the
 * display draw / scroll / set-pixel ports. A draw crosses the port only when it
 * paints (a draw dropped on a busy display paints nothing); a scroll crosses the
 * port only when the display is free; the display poll runs after each think so
 * a settled lease resumes the awaiting fiber on the next think.
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

/** The 1-based tick index whose block contains the first line matching `predicate`, or -1. */
function tickOfLine(trace: string, predicate: (line: string) => boolean): number {
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (predicate(line)) {
      return currentTick;
    }
  }
  return -1;
}

/**
 * Pins the `.mcprogram` / `.mcprogram.bin` / `.ticks.trace` golden triple for a
 * display-lease fixture: the JSON freezes the brain's generated page id, the
 * bytes are byte-stable across builds, two fresh runs render identical traces,
 * and the rendered trace matches the committed golden.
 */
function runFixture(
  name: string,
  files: ReadonlyMap<string, string>,
  actuatorNames: readonly string[],
  tickCount: number,
  structure: "single" | "siblings"
): string {
  const jsonPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram`, import.meta.url));
  const binPath = fileURLToPath(new URL(`./__fixtures__/${name}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${name}.ticks.trace`, import.meta.url));

  if (!existsSync(jsonPath)) {
    const environment = createMicroBitV2Environment();
    const image = buildImage(environment, files, actuatorNames, structure);
    writeFileSync(
      jsonPath,
      serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
    );
  }
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (!existsSync(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${name}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin, tickCount);
  const second = runTrace(bin, tickCount);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, tickCount);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // The async draw / scroll are host functions (op 41), so no `action ... async` line.
  assert.equal(lines.filter((line) => line.endsWith(" async")).length, 0);

  if (!existsSync(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${name}.ticks.trace is not byte-stable`);
  return first.trace;
}

/** The tick a root rule's async host function dispatches on: one think after the rule fires on tick 1. */
const DISPATCH_TICK = 2;

test("a user-tile drawImage with immediately preempts a held scroll, whose rule resumes", () => {
  // Two root rules fire the same round: the first awaits `scrollText` and takes
  // the display lease; the second draws with `immediately`, preempting the
  // holder at dispatch. Both cross the port on the dispatch tick; the preempted
  // scroll's rule resumes well before its own scroll would complete.
  const holdText = "hello";
  const trace = runFixture(
    "user-tile-display-draw-preempts-scroll",
    new Map([
      ["scroll-hold.ts", scrollActuatorSource("scroll-hold", holdText, true)],
      ["draw-preempt.ts", drawActuatorSource("draw-preempt", 0.6, true, { immediately: true })],
    ]),
    ["scroll-hold", "draw-preempt"],
    6,
    "siblings"
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === `port display scroll "${holdText}"`).length, 1);
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${TOP_ROW_HEX}`).length, 1);
  // Both ops cross the port on the shared dispatch tick.
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display scroll ")),
    DISPATCH_TICK
  );
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display draw ")),
    DISPATCH_TICK
  );
  // Both rules resume: the preempted holder well before its own scroll would
  // complete, the preemptor after its own draw's nominal hold.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  const scrollNaturalResume =
    Math.floor(scrollCompletionTimeMs(TICK_ADVANCE_MS, holdText.length, SCROLL_DEFAULT_DELAY_MS) / TICK_ADVANCE_MS) + 2;
  const firstPixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  assert.ok(firstPixelTick > DISPATCH_TICK && firstPixelTick < scrollNaturalResume);
});

test("a user-tile scrollText with immediately preempts a held draw, whose rule resumes", () => {
  // The mirror: the first rule awaits a long `drawImage` and holds the lease;
  // the second scrolls with `immediately`, preempting the holder at dispatch.
  const preemptText = "A";
  const holdSeconds = 5;
  const trace = runFixture(
    "user-tile-display-scroll-preempts-draw",
    new Map([
      ["draw-hold.ts", drawActuatorSource("draw-hold", holdSeconds, true)],
      ["scroll-preempt.ts", scrollActuatorSource("scroll-preempt", preemptText, true, { immediately: true })],
    ]),
    ["draw-hold", "scroll-preempt"],
    6,
    "siblings"
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${TOP_ROW_HEX}`).length, 1);
  assert.equal(lines.filter((line) => line === `port display scroll "${preemptText}"`).length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display draw ")),
    DISPATCH_TICK
  );
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display scroll ")),
    DISPATCH_TICK
  );
  // The preempted draw's rule resumes far below the draw's own nominal hold.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  const drawNaturalResume = Math.floor((TICK_ADVANCE_MS + holdSeconds * 1000) / TICK_ADVANCE_MS) + 2;
  const firstPixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  assert.ok(firstPixelTick > DISPATCH_TICK && firstPixelTick < drawNaturalResume);
});

test("a user-tile drawImage in background keeps its lease while the issuing rule continues", () => {
  // `inBackground` resolves the await at dispatch, so the marker lands on the
  // dispatch tick while the draw keeps its display lease for many more thinks.
  const tickCount = 4;
  const trace = runFixture(
    "user-tile-display-draw-background",
    new Map([["draw-background.ts", drawActuatorSource("draw-background", 2, true, { inBackground: true })]]),
    ["draw-background"],
    tickCount,
    "single"
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === `port display draw 5 5 ${TOP_ROW_HEX}`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  const pixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  // The marker lands the same round the draw dispatched, and the lease is still
  // held at the end of the run (a 2s hold dispatched at tick 2, time 1000).
  assert.equal(pixelTick, DISPATCH_TICK);
  assert.ok(tickCount > pixelTick + 1, "the background draw holds the lease past the issuing rule's think");
});

test("a user-tile scrollText in background keeps its lease while the issuing rule continues", () => {
  const tickCount = 4;
  const holdText = "hello";
  const trace = runFixture(
    "user-tile-display-scroll-background",
    new Map([
      ["scroll-background.ts", scrollActuatorSource("scroll-background", holdText, true, { inBackground: true })],
    ]),
    ["scroll-background"],
    tickCount,
    "single"
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === `port display scroll "${holdText}"`).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  const pixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  assert.equal(pixelTick, DISPATCH_TICK);
  const scrollNaturalResume =
    Math.floor(scrollCompletionTimeMs(TICK_ADVANCE_MS, holdText.length, SCROLL_DEFAULT_DELAY_MS) / TICK_ADVANCE_MS) + 2;
  assert.ok(pixelTick < scrollNaturalResume, "the background scroll resolves at dispatch, not on completion");
  assert.ok(tickCount > pixelTick + 1, "the background scroll holds the lease past the issuing rule's think");
});
