/**
 * Goldens for the TS user-code audio API (`ctx.microbit.audio.playSound`):
 * user-tile brains whose async actuators await `playSound`, the asynchronous
 * `ctx.microbit.*` host function (op 41 `HOST_CALL_ASYNC`) over the same
 * speaker facade the play-sound tile action drives. Three fixtures pin the
 * behavior reached through the host-function path:
 *
 * - awaited: a built-in name takes the speaker lease for its nominal duration;
 *   the actuator parks on the awaited handle, resumes on the think after the
 *   speaker poll settles the lease, and lights a marker pixel through
 *   `setPixelValue`.
 * - unknown: a name outside the built-in set is a silent no-op -- no port line,
 *   the handle resolves at once, and the marker lands on the dispatch tick.
 * - all: a ten-level child-rule chain, one awaited play per rule, `giggle`
 *   through `yawn`. Each rule's actuator dispatches with the fresh time of the
 *   round its rule fired (an async bytecode action runs on a context snapshot,
 *   so a single actuator awaiting all ten in sequence would reuse its first
 *   dispatch time and every later play would settle at once). Ten port lines,
 *   and each play's settle tick pins that sound's nominal duration cross-VM.
 *
 * The root rule fires once on page entry (the core `on page entered` host
 * sensor); each `do` is a compiled async actuator, whose `playSound` /
 * `setPixelValue` cross the speaker and display ports as host functions, which
 * carry no host-action dispatch line. The serialized binary and the rendered
 * trace are pinned beside this spec; the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the
 * schedule, and byte-compares.
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
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { BUILT_IN_SOUNDS, findBuiltInSound } from "./built-in-sounds";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";

/**
 * Milliseconds advanced per scheduled think. Below every built-in sound's
 * nominal duration, so no play completes within its own dispatch tick (an
 * actuator's context snapshot freezes its lease start one tick before the
 * dispatch, and a same-tick completion would settle on a poll-ordering corner
 * the two VM harnesses time differently).
 */
const TICK_ADVANCE_MS = 500;

/** The two optional lease flags of a `playSound` call, defaulting false. */
interface PlaySoundFlags {
  /** Preempt the current speaker lease at dispatch and play now. */
  readonly immediately?: boolean;

  /** Resolve the call at dispatch so the caller continues without awaiting playback. */
  readonly inBackground?: boolean;
}

/** A `ctx.microbit.audio.playSound(...)` call, adding the options struct only when a flag is set. */
function playSoundCall(sound: string, flags: PlaySoundFlags): string {
  const entries: string[] = [];
  if (flags.immediately) {
    entries.push("immediately: true");
  }
  if (flags.inBackground) {
    entries.push("inBackground: true");
  }
  const options = entries.length > 0 ? `, { ${entries.join(", ")} }` : "";
  return `ctx.microbit.audio.playSound(${JSON.stringify(sound)}${options})`;
}

/**
 * Source of an async actuator that awaits `playSound(sound)` with the given
 * lease flags and, when `marker` is set, lights pixel (4,4) once the await
 * resolves.
 */
function actuatorSource(name: string, sound: string, marker: boolean, flags: PlaySoundFlags = {}): string {
  const markerLine = marker ? "\n    ctx.microbit.display.setPixelValue(4, 4, 255);" : "";
  return `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "${name}",
  async onExecute(ctx: Context): Promise<void> {
    await ${playSoundCall(sound, flags)};${markerLine}
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
 * brain whose rules each fire on page entry (the core `on page entered`
 * sensor) and run one actuator. With `structure: "chain"` (the default) each
 * further actuator runs in a child rule nested under the previous one, firing
 * when its parent's do completes; with `structure: "siblings"` each runs in its
 * own root rule, so all dispatch the same round and compete for the lease.
 */
function buildImage(
  environment: MindcraftEnvironment,
  files: ReadonlyMap<string, string>,
  actuatorNames: readonly string[],
  structure: "chain" | "siblings" = "chain"
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

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile play-sound brain");
  const page = brainDef.pages().get(0)! as BrainPageDef;
  let rule = page.children().get(0)! as BrainRuleDef;
  rule.when().appendTile(onPageEntered);
  for (let i = 0; i < actuatorNames.length; i++) {
    if (i > 0) {
      rule = structure === "siblings" ? (page.appendNewRule() as BrainRuleDef) : rule.appendNewRule();
      // A sibling root fires on page entry like the first; a chained child
      // fires when its parent's do completes, so it carries no when tile.
      if (structure === "siblings") {
        rule.when().appendTile(onPageEntered);
      }
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
 * each with the trace observers installed: the on-page-entered host sensor (its
 * async actuators play and write through host functions, which carry no
 * host-action dispatch line) plus the speaker and set-pixel ports. The speaker
 * port line is emitted only for an accepted play (a dropped or unknown-name
 * play crosses no port), and the speaker poll runs after each think so a
 * completed play settles and the awaiting fiber resumes on the next think.
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
  const devicePlaySoundEmoji = microbit.speaker.playSoundEmoji.bind(microbit.speaker);
  microbit.speaker.playSoundEmoji = (name, requestTime, onComplete) => {
    // A dropped or unknown-name play crosses no port and emits no line.
    if (!microbit.speaker.isBusy() && findBuiltInSound(name) !== undefined) {
      writer.speakerPlay(name);
    }
    devicePlaySoundEmoji(name, requestTime, onComplete);
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
    microbit.speaker.advancePlay(timeMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

/** The nominal duration of a built-in sound, from the pinned table. */
function nominalDurationMs(name: string): number {
  const def = findBuiltInSound(name);
  assert.ok(def, `unknown built-in sound '${name}'`);
  return def.durationMs;
}

/** One awaited play of the rule chain: its port-line tick and settle tick. */
interface ChainStep {
  /** 1-based tick on which the play's port line appears. */
  readonly portTick: number;

  /** 1-based tick whose speaker poll settles the play's lease. */
  readonly settleTick: number;
}

/**
 * The play schedule of a chained-rule fixture whose root rule fires on tick 1.
 * A rule's async bytecode actuator dispatches on the think after the rule
 * fired, on a context snapshot frozen at the rule's round, so the play's lease
 * runs from the rule's round time for the sound's nominal duration. The
 * speaker poll of the first think at or past completion settles the lease
 * (after that think ran); the actuator resumes and completes on the next
 * think, the parent rule's fiber resumes on the think after that, and its
 * child rule fires there, dispatching the next actuator. The final entry's
 * settle tick + 1 is the tick the chain's last resume lands on.
 */
function chainSchedule(soundNames: readonly string[]): ChainStep[] {
  const steps: ChainStep[] = [];
  let ruleTick = 1;
  for (const name of soundNames) {
    const settleTick = ruleTick + Math.max(1, Math.ceil(nominalDurationMs(name) / TICK_ADVANCE_MS));
    steps.push({ portTick: ruleTick + 1, settleTick });
    ruleTick = settleTick + 2;
  }
  return steps;
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

/** The 1-based tick index of the last line matching `predicate`, or -1. */
function lastTickOfLine(trace: string, predicate: (line: string) => boolean): number {
  let currentTick = 0;
  let found = -1;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (predicate(line)) {
      found = currentTick;
    }
  }
  return found;
}

/**
 * Pins the `.mcprogram` / `.mcprogram.bin` / `.ticks.trace` golden triple for
 * a play-sound fixture: the JSON freezes the brain's generated page id, the
 * bytes are byte-stable across builds, two fresh runs render identical traces,
 * and the rendered trace matches the committed golden.
 */
function runPlaySoundFixture(
  name: string,
  files: ReadonlyMap<string, string>,
  actuatorNames: readonly string[],
  tickCount: number,
  structure: "chain" | "siblings" = "chain"
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
  if (shouldWriteGolden(binPath)) {
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
  // Each compiled async actuator dispatches once; the host functions (op 41)
  // they await carry no `action ... async` line of their own.
  assert.equal(
    lines.filter((line) => line.startsWith("tile ") && line.endsWith(" async")).length,
    actuatorNames.length
  );
  assert.equal(lines.filter((line) => line.startsWith("action ") && line.endsWith(" async")).length, 0);

  if (shouldWriteGolden(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${name}.ticks.trace is not byte-stable`);
  return first.trace;
}

test("a user-tile awaited playSound holds the speaker, parks, and resumes", () => {
  const sound = "happy";
  const [step] = chainSchedule([sound]);
  const markerTick = step!.settleTick + 1;
  const trace = runPlaySoundFixture(
    "user-tile-play-sound",
    new Map([["user-play-sound.ts", actuatorSource("user-play-sound", sound, true)]]),
    ["user-play-sound"],
    markerTick
  );
  const lines = trace.split("\n");
  // One play crosses the port; the marker pixel only after the play resolves.
  assert.equal(lines.filter((line) => line === `port speaker play "${sound}"`).length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port speaker play ")),
    step!.portTick
  );
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    markerTick
  );
});

test("a user-tile playSound of an unknown name is a silent no-op that resolves at once", () => {
  const trace = runPlaySoundFixture(
    "user-tile-play-sound-unknown",
    new Map([["user-play-sound-unknown.ts", actuatorSource("user-play-sound-unknown", "bogus", true)]]),
    ["user-play-sound-unknown"],
    2
  );
  const lines = trace.split("\n");
  // Nothing crosses the speaker port; the marker lands on the dispatch tick.
  assert.equal(lines.filter((line) => line.startsWith("port speaker play ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    2
  );
});

test("a chained rule per built-in awaits each play, pinning every nominal duration", () => {
  const soundNames = BUILT_IN_SOUNDS.map((def) => def.name);
  const steps = chainSchedule(soundNames);
  const markerTick = steps[steps.length - 1]!.settleTick + 1;
  const files = new Map<string, string>();
  const actuatorNames: string[] = [];
  for (let i = 0; i < soundNames.length; i++) {
    const actuatorName = `user-play-all-${soundNames[i]}`;
    const marker = i === soundNames.length - 1;
    files.set(`${actuatorName}.ts`, actuatorSource(actuatorName, soundNames[i]!, marker));
    actuatorNames.push(actuatorName);
  }
  const trace = runPlaySoundFixture("user-tile-play-sound-all", files, actuatorNames, markerTick);
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("port speaker play ")).length, soundNames.length);
  // Each play's port line lands on the tick its rule's round predicts, and the
  // next rule fires on the tick the previous sound's nominal duration
  // predicts: a duration divergence in either VM moves the whole tail.
  for (let i = 0; i < soundNames.length; i++) {
    const name = soundNames[i]!;
    assert.equal(
      tickOfLine(trace, (l) => l === `port speaker play "${name}"`),
      steps[i]!.portTick,
      `dispatch tick of '${name}'`
    );
  }
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    markerTick
  );
});

test("a user-tile playSound with immediately preempts the holder, whose rule resumes", () => {
  // Two root rules fire the same round: the first awaits `twinkle` and takes
  // the lease; the second plays `happy` with `immediately`, which preempts the
  // holder at dispatch. Both plays cross the port on the dispatch tick; the
  // preempted holder resumes well before its own sound's nominal completion.
  const [happyStep] = chainSchedule(["happy"]);
  const markerTick = happyStep!.settleTick + 1;
  const trace = runPlaySoundFixture(
    "user-tile-play-sound-preempt",
    new Map([
      ["user-play-hold.ts", actuatorSource("user-play-hold", "twinkle", true)],
      ["user-play-preempt.ts", actuatorSource("user-play-preempt", "happy", true, { immediately: true })],
    ]),
    ["user-play-hold", "user-play-preempt"],
    markerTick,
    "siblings"
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === 'port speaker play "twinkle"').length, 1);
  assert.equal(lines.filter((line) => line === 'port speaker play "happy"').length, 1);
  // Both plays cross the port on the shared dispatch tick.
  assert.equal(
    lastTickOfLine(trace, (l) => l.startsWith("port speaker play ")),
    happyStep!.portTick
  );
  // Both rules resume: the preempted holder well before `twinkle` would settle
  // naturally, the preemptor after `happy`'s own nominal duration.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  const [twinkleStep] = chainSchedule(["twinkle"]);
  const twinkleNaturalResume = twinkleStep!.settleTick + 1;
  const firstPixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  assert.ok(firstPixelTick > 0 && firstPixelTick < twinkleNaturalResume);
  assert.equal(
    lastTickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    markerTick
  );
});

test("a user-tile playSound in background keeps its lease while the issuing rule continues", () => {
  // `inBackground` resolves the await at dispatch, so the marker lands on the
  // dispatch tick while `twinkle` keeps its speaker lease for many more thinks.
  const tickCount = 4;
  const trace = runPlaySoundFixture(
    "user-tile-play-sound-background",
    new Map([
      ["user-play-background.ts", actuatorSource("user-play-background", "twinkle", true, { inBackground: true })],
    ]),
    ["user-play-background"],
    tickCount
  );
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === 'port speaker play "twinkle"').length, 1);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  const pixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  // The marker lands the same round the play dispatched, far below the tick
  // `twinkle` would settle on if the rule had awaited its full duration.
  const [twinkleStep] = chainSchedule(["twinkle"]);
  assert.equal(pixelTick, twinkleStep!.portTick);
  assert.ok(pixelTick < twinkleStep!.settleTick + 1);
  assert.ok(tickCount > pixelTick + 1, "the background play holds the lease past the issuing rule's think");
});
