/**
 * Golden observable traces for REAL compiled brains exercising the `play
 * sound` actuator against the speaker lease. Each fixture brain is built
 * through the tile API and compiled by the brain compiler: every root rule
 * fires once on page entry (the core `on page entered` sensor), its DO is one
 * `play sound` dispatch, and a child rule lights a pixel once the parent's DO
 * completes (the compiler-emitted SPAWN_RULE), surfacing the resume round.
 *
 * The fixtures pin, cross-VM:
 *
 * - awaited: a bare `play sound` plays the default `hello` and the rule parks
 *   for exactly the nominal duration.
 * - dropped: a play dispatched while the speaker is busy is silently dropped
 *   (no port line) and resolves at once.
 * - preempt: `immediately` preempts the holder (its rule resumes, not an
 *   error) and the new sound takes the speaker.
 * - background: `in background` resolves the handle at dispatch while the
 *   sound keeps its speaker lease, settled on tick time.
 * - dropped-background: a busy-dropped play WITH `in background` settles its
 *   handle in the drop path and again at the background resolve (the display
 *   family's exact double-settle sequence).
 *
 * The JSON, binary, and rendered trace of each fixture are pinned beside this
 * spec as the cross-VM conformance fixtures: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binaries and byte-compares
 * the traces.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CoreHostActions,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson, type VmEvents } from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { BUILT_IN_SOUNDS, type BuiltInSoundDef, builtInSoundTileId, findBuiltInSound } from "./built-in-sounds";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId } from "./tile-ids";

const PLAY_SOUND = MicroBitV2HostActions.PlaySound.actionId;

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;

/** One root rule of a fixture brain: its optional sound literal and modifiers. */
interface PlayRuleSpec {
  /** Built-in sound literal appended to the play tile; absent plays the default. */
  readonly sound?: string;

  /** Append the `immediately` modifier. */
  readonly immediately?: boolean;

  /** Append the `in background` modifier. */
  readonly inBackground?: boolean;
}

/** The nominal duration of a built-in sound, from the pinned table. */
function nominalDurationMs(name: string): number {
  const def: BuiltInSoundDef | undefined = BUILT_IN_SOUNDS.find((sound) => sound.name === name);
  assert.ok(def, `unknown built-in sound '${name}'`);
  return def.durationMs;
}

/**
 * The 1-based tick on which an awaited play dispatched on tick 1 resumes its
 * rule: the lease settles on the first think at or past `dispatch + duration`
 * (after that think ran), and the fiber resumes on the think after that.
 */
function resumeTickFor(durationMs: number): number {
  return Math.ceil((TICK_ADVANCE_MS + durationMs) / TICK_ADVANCE_MS) + 1;
}

/**
 * A one-page brain with one root rule per spec: each fires on page entry, its
 * DO is a `play sound` with the spec's sound literal and modifiers, and its
 * single child rule lights a pixel.
 */
function buildBrainDef(env: MindcraftEnvironment, base: string, rules: readonly PlayRuleSpec[]): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const playTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.PlaySound.key));
  const immediately = tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.Immediately));
  const inBackground = tiles.get(mkModifierTileId(WodalMicroBitV2ModifierId.InBackground));
  const setPixelTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  assert.ok(onPageEntered);
  assert.ok(playTile);
  assert.ok(immediately);
  assert.ok(inBackground);
  assert.ok(setPixelTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${base} brain`);
  const page = brainDef.pages().get(0)! as BrainPageDef;

  for (let i = 0; i < rules.length; i++) {
    const spec = rules[i]!;
    const rule = i === 0 ? (page.children().get(0)! as BrainRuleDef) : page.appendNewRule();
    rule.when().appendTile(onPageEntered);
    rule.do().appendTile(playTile);
    if (spec.sound !== undefined) {
      const def = BUILT_IN_SOUNDS.find((sound) => sound.name === spec.sound);
      assert.ok(def, `unknown built-in sound '${spec.sound}'`);
      const literal = tiles.get(builtInSoundTileId(def));
      assert.ok(literal, `sound literal tile for '${spec.sound}' should be registered`);
      rule.do().appendTile(literal);
    }
    if (spec.immediately) {
      rule.do().appendTile(immediately);
    }
    if (spec.inBackground) {
      rule.do().appendTile(inBackground);
    }
    rule.appendNewRule().do().appendTile(setPixelTile);
  }

  return brainDef;
}

function buildImage(
  env: MindcraftEnvironment,
  base: string,
  rules: readonly PlayRuleSpec[]
): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef: buildBrainDef(env, base, rules),
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

/**
 * Runs the committed binary over `tickCount` thinks at {@link TICK_ADVANCE_MS}
 * each with the trace taps installed: the on-page-entered and set-pixel sync
 * actions, the async play-sound action, the speaker port (a play the busy
 * speaker drops, or an unknown name, crosses no port and emits no line), and
 * fiber faults. The runtime tick settles the speaker lease after each think,
 * so a completed play's fiber resumes on the following think.
 */
function runTrace(bin: Uint8Array, tickCount: number): string {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
  });

  const playAction = environment.brainServices.runtime.actions.getById(PLAY_SOUND);
  assert.ok(playAction !== undefined && playAction.binding === "host");
  const execAsync = playAction.execAsync;
  assert.ok(execAsync !== undefined);
  playAction.execAsync = (ctx, args, handle) => {
    const callSiteId = ctx.currentCallSiteId;
    assert.ok(callSiteId !== undefined);
    execAsync(ctx, args, handle);
    writer.hostActionCallAsync(PLAY_SOUND, callSiteId, args);
  };

  for (const actionId of [CoreHostActions.OnPageEntered.actionId, MicroBitV2HostActions.DisplaySetPixel.actionId]) {
    const syncAction = environment.brainServices.runtime.actions.getById(actionId);
    assert.ok(syncAction !== undefined && syncAction.binding === "host");
    const syncExec = syncAction.execSync;
    assert.ok(syncExec !== undefined);
    syncAction.execSync = (ctx, args) => {
      const result = syncExec(ctx, args);
      const callSiteId = ctx.currentCallSiteId;
      assert.ok(callSiteId !== undefined);
      writer.hostActionCall(actionId, callSiteId, args, result);
      return result;
    };
  }

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

  const vmEvents: VmEvents = {
    onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code),
  };
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (let i = 0; i < tickCount; i++) {
    const timeMs = lastThinkTimeMs + TICK_ADVANCE_MS;
    writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(TICK_ADVANCE_MS);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

/** The 1-based tick index whose block contains the first line matching `predicate`, or -1. */
function tickOfLine(trace: string, predicate: (line: string) => boolean): number {
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 10);
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
      currentTick = Number.parseInt(line.split(" ")[1]!, 10);
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
function runPlaySoundFixture(base: string, rules: readonly PlayRuleSpec[], tickCount: number): string {
  const jsonPath = fileURLToPath(new URL(`./__fixtures__/${base}.mcprogram`, import.meta.url));
  const binPath = fileURLToPath(new URL(`./__fixtures__/${base}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${base}.ticks.trace`, import.meta.url));

  if (!existsSync(jsonPath)) {
    const env = createMicroBitV2Environment();
    const image = buildImage(env, base, rules);
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
  assert.deepEqual(bin, generated, `${base}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin, tickCount);
  const second = runTrace(bin, tickCount);
  assert.equal(second, first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, tickCount);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  if (!existsSync(tracePath)) {
    writeFileSync(tracePath, first);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first, `${base}.ticks.trace is not byte-stable`);
  return first;
}

test("an awaited bare play sound plays the default hello and parks for its nominal duration", () => {
  const tickCount = resumeTickFor(nominalDurationMs("hello"));
  const trace = runPlaySoundFixture("play-sound-awaited", [{}], tickCount);
  const lines = trace.split("\n");
  // The bare play resolves the default sound and takes the speaker lease.
  assert.equal(lines.filter((line) => line === 'port speaker play "hello"').length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port speaker play ")),
    1
  );
  // The rule parks for the nominal duration; its child marks the resume tick.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    tickCount
  );
});

test("a play sound dispatched while the speaker is busy is silently dropped", () => {
  const tickCount = resumeTickFor(nominalDurationMs("happy"));
  const trace = runPlaySoundFixture("play-sound-dropped", [{ sound: "happy" }, { sound: "twinkle" }], tickCount);
  const lines = trace.split("\n");
  // Only the holder's play crosses the port; the competitor's is dropped.
  assert.equal(lines.filter((line) => line.startsWith("port speaker play ")).length, 1);
  assert.equal(lines.filter((line) => line === 'port speaker play "happy"').length, 1);
  // Both rules dispatch a play, so two async play lines appear.
  const playHex = (PLAY_SOUND >>> 0).toString(16);
  assert.equal(lines.filter((line) => new RegExp(`^action ${playHex} .+ async$`).test(line)).length, 2);
  // The dropped rule resolves at once (its child marks tick 1); the holder
  // resumes after its nominal duration.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    1
  );
  assert.equal(
    lastTickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    tickCount
  );
});

test("a play sound with immediately preempts the holder, whose rule resumes", () => {
  const tickCount = resumeTickFor(nominalDurationMs("happy"));
  const trace = runPlaySoundFixture(
    "play-sound-preempt",
    [{ sound: "twinkle" }, { sound: "happy", immediately: true }],
    tickCount
  );
  const lines = trace.split("\n");
  // Both plays cross the port on the dispatch tick: the holder's, then the
  // preemptor's after the preempt released the lease.
  assert.equal(lines.filter((line) => line === 'port speaker play "twinkle"').length, 1);
  assert.equal(lines.filter((line) => line === 'port speaker play "happy"').length, 1);
  assert.equal(
    lastTickOfLine(trace, (l) => l.startsWith("port speaker play ")),
    1
  );
  // Both children light a pixel: the preempted holder resumes well before its
  // sound's nominal completion, and the preemptor resumes after its own sound.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  const holderNaturalResume = resumeTickFor(nominalDurationMs("twinkle"));
  const firstPixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  assert.ok(firstPixelTick > 0 && firstPixelTick < holderNaturalResume);
  assert.equal(
    lastTickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    tickCount
  );
});

test("a play sound in background keeps its lease while the issuing rule continues", () => {
  // The lease settles on tick time after the nominal duration; run past it.
  const tickCount = resumeTickFor(nominalDurationMs("twinkle")) - 1;
  const trace = runPlaySoundFixture("play-sound-background", [{ sound: "twinkle", inBackground: true }], tickCount);
  const lines = trace.split("\n");
  assert.equal(lines.filter((line) => line === 'port speaker play "twinkle"').length, 1);
  // The handle resolves at dispatch: the child drains on the dispatch tick
  // while the sound still holds the speaker lease for several more thinks.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  const pixelTick = tickOfLine(trace, (l) => l.startsWith("port display set-pixel "));
  assert.equal(pixelTick, 1);
  assert.ok(tickCount > pixelTick + 1, "the background play holds the lease past the child's think");
});

test("a busy-dropped play sound with in background settles its handle twice", () => {
  const tickCount = resumeTickFor(nominalDurationMs("twinkle"));
  const trace = runPlaySoundFixture(
    "play-sound-dropped-background",
    [{ sound: "twinkle" }, { sound: "happy", inBackground: true }],
    tickCount
  );
  const lines = trace.split("\n");
  // Only the holder's play crosses the port; the busy-dropped background play
  // settles in the drop path and again at the background resolve, fault-free.
  assert.equal(lines.filter((line) => line.startsWith("port speaker play ")).length, 1);
  assert.equal(lines.filter((line) => line === 'port speaker play "twinkle"').length, 1);
  // The dropped rule continues on the dispatch tick; the holder resumes after
  // its nominal duration.
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  assert.equal(
    tickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    1
  );
  assert.equal(
    lastTickOfLine(trace, (l) => l.startsWith("port display set-pixel ")),
    tickCount
  );
});
