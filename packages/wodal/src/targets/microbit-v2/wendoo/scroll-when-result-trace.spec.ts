/**
 * Golden observable traces for the WHEN-result capture: real compiled brains
 * whose single rule has a value-producing WHEN side and a DO side that scrolls
 * text with no explicit text argument. The VM captures the WHEN result into the
 * rule's reserved __whenResult variable at WHEN_END, and the scroll actuator
 * falls back to it. A numeric WHEN (the literal 42) scrolls "42"; a boolean WHEN
 * (the literal true) is not text-convertible, so the scroll keeps its default
 * "hello". The brains are built through the tile API and compiled by the brain
 * compiler (not hand-authored bytecode). Each serialized binary and rendered
 * trace is pinned beside this spec as a cross-VM fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the schedule,
 * and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CoreTypeIds, type IBrainTileDef, mkActuatorTileId, type WendooEnvironment } from "@wendoo/core/app";
import { BrainDef } from "@wendoo/core/brain/model";
import { BrainTileLiteralDef } from "@wendoo/core/brain/tiles";
import {
  BrainRuntime,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  type PlatformServices,
} from "@wendoo/core/runtime";
import { buildWodalProgramImage } from "../../../wendoo/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../wendoo/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

/** Text the scroll actuator shows when no text argument and no convertible WHEN result is available. */
const DEFAULT_SCROLL_TEXT = "hello";

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 1100;

/** One WHEN-result golden: its fixture base name, WHEN-side tile, and the text the scroll shows. */
interface Variant {
  base: string;
  makeWhenTile: (env: WendooEnvironment) => IBrainTileDef;
  expectedText: string;
}

const VARIANTS: readonly Variant[] = [
  {
    base: "scroll-when-result",
    makeWhenTile: (env) => new BrainTileLiteralDef(CoreTypeIds.Number, 42, {}, env.brainServices),
    expectedText: "42",
  },
  {
    base: "scroll-when-result-bool",
    makeWhenTile: (env) => new BrainTileLiteralDef(CoreTypeIds.Boolean, true, {}, env.brainServices),
    expectedText: DEFAULT_SCROLL_TEXT,
  },
];

function fixturePath(base: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${base}.${extension}`, import.meta.url));
}

/**
 * A single-page brain whose one rule has `variant`'s WHEN tile (truthy, so the
 * DO runs) and a DO that scrolls text with no explicit text argument.
 */
function buildBrainDef(env: WendooEnvironment, variant: Variant): BrainDef {
  const scrollTile = env.brainServices.edit.tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key));
  assert.ok(scrollTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${variant.base} brain`);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(variant.makeWhenTile(env));
  rule.do().appendTile(scrollTile);
  return brainDef;
}

/** Builds a variant's brain image through the standard build path. */
function buildImage(env: WendooEnvironment, variant: Variant): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef: buildBrainDef(env, variant),
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

/** Writes a variant's JSON `.mcprogram` golden if missing, freezing the brain's generated id. */
function ensureJsonGolden(variant: Variant): void {
  const jsonPath = fixturePath(variant.base, "mcprogram");
  if (existsSync(jsonPath)) {
    return;
  }
  const env = createMicroBitV2Environment();
  const image = buildImage(env, variant);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

function hostServicesOf(environment: WendooEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Runs `bin` over `tickCount` thinks at {@link TICK_ADVANCE_MS} each, with the
 * trace observers and display-scroll port tap installed so the dispatch crosses
 * the trace.
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
    if (!microbit.display.isBusy()) {
      writer.displayScroll(text);
    }
    deviceScrollText(text, durationMs, requestTime, onComplete);
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

for (const variant of VARIANTS) {
  test(`the committed ${variant.base} binary and observable trace golden are byte-stable`, () => {
    ensureJsonGolden(variant);
    const generated = wodalProgramBytes(new Uint8Array(readFileSync(fixturePath(variant.base, "mcprogram"))));
    const binPath = fixturePath(variant.base, "mcprogram.bin");
    if (shouldWriteGolden(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${variant.base}.mcprogram.bin is not byte-stable`);

    const first = runTrace(bin, 1);
    const second = runTrace(bin, 1);
    assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

    // With no explicit text arg, the scroll shows the variant's expected text.
    const lines = first.trace.split("\n");
    assert.equal(lines.filter((line) => line === `port display scroll "${variant.expectedText}"`).length, 1);
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

    const tracePath = fixturePath(variant.base, "ticks.trace");
    if (shouldWriteGolden(tracePath)) {
      writeFileSync(tracePath, first.trace);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${variant.base}.ticks.trace is not byte-stable`);
  });
}
