/**
 * Golden for the built-in "clear display" actuator tile (a synchronous, no-arg
 * host actuator dispatched as `HOST_ACTION_CALL`). A real compiler-built brain
 * places two built-in tiles across two rules that both fire on page entry: rule
 * 0 lights pixel (0,0) with the set-pixel tile, and rule 1 blanks the matrix with
 * the clear-display tile. Running in rule order in one think, the set-pixel port
 * line lands before the clear port line and the display ends blank.
 *
 * The set-pixel and clear tiles cross the display port and carry a host-action
 * dispatch line (unlike the device-API `ctx.microbit.display.clear()` host
 * function, whose tile-free path the display-clear goldens pin). The clear tile
 * reaches the same display facade `clear()` the device-API method does, so a
 * tile-initiated clear preempts a held display lease identically; that
 * preemption is pinned method-side by the `display-clear-preempts` golden and is
 * out of scope here.
 *
 * The serialized binary and rendered trace are pinned beside this spec; the C++
 * VM parity test (cpp/test/trace-parity.test.cpp) loads the same binary, replays
 * the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CoreHostActions, type MindcraftEnvironment, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainRuntime,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  type PlatformServices,
} from "@mindcraft-lang/core/runtime";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { MicroBitV2HostActions } from "./tile-ids";

const DISPLAY_CLEAR = MicroBitV2HostActions.DisplayClear.actionId;

/** Milliseconds advanced per scheduled think. */
const TICK_ADVANCE_MS = 100;

const FIXTURE_NAME = "display-clear-tile";

function hostServicesOf(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

/**
 * Builds a single-page brain: rule 0 lights pixel (0,0) with the set-pixel tile
 * (bare defaults), rule 1 blanks the matrix with the clear-display tile. Both
 * rules fire on page entry.
 */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const tiles = environment.brainServices.edit.tiles;
  const onPageEntered = tiles.get(mkSensorTileId(CoreHostActions.OnPageEntered.key));
  const setPixelTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  const clearTile = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayClear.key));
  assert.ok(onPageEntered, "on page entered sensor tile should be registered");
  assert.ok(setPixelTile, "set-pixel actuator tile should be registered");
  assert.ok(clearTile, "clear-display actuator tile should be registered");

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "clear-display tile brain");
  const page = brainDef.pages().get(0)!;
  const setPixelRule = page.children().get(0)!;
  setPixelRule.when().appendTile(onPageEntered);
  setPixelRule.do().appendTile(setPixelTile);
  const clearRule = page.appendNewRule();
  assert.ok(clearRule);
  clearRule.when().appendTile(onPageEntered);
  clearRule.do().appendTile(clearTile);

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
function ensureJsonGolden(jsonPath: string): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/**
 * Runs the committed binary over `tickCount` thinks at {@link TICK_ADVANCE_MS}
 * each with the trace observers installed: the on-page-entered, set-pixel, and clear
 * host actions (each a `HOST_ACTION_CALL`, so each carries a dispatch line) plus
 * the display set-pixel and clear ports.
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

test("the clear-display tile blanks the matrix after a set-pixel, and the trace golden is byte-stable", () => {
  const jsonPath = fileURLToPath(new URL(`./__fixtures__/${FIXTURE_NAME}.mcprogram`, import.meta.url));
  const binPath = fileURLToPath(new URL(`./__fixtures__/${FIXTURE_NAME}.mcprogram.bin`, import.meta.url));
  const tracePath = fileURLToPath(new URL(`./__fixtures__/${FIXTURE_NAME}.ticks.trace`, import.meta.url));

  ensureJsonGolden(jsonPath);
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (!existsSync(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${FIXTURE_NAME}.mcprogram.bin is not byte-stable`);

  const first = runTrace(bin, 2);
  const second = runTrace(bin, 2);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  if (!existsSync(tracePath)) {
    writeFileSync(tracePath, first.trace);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${FIXTURE_NAME}.ticks.trace is not byte-stable`);

  const lines = first.trace.split("\n");
  const clearHex = (DISPLAY_CLEAR >>> 0).toString(16);
  const setPixelLine = lines.findIndex((line) => line.startsWith("port display set-pixel "));
  const clearLine = lines.indexOf("port display clear");
  // The pixel is lit before the clear crosses the port.
  assert.ok(setPixelLine >= 0, "a set-pixel port line should appear");
  assert.ok(clearLine >= 0, "a clear port line should appear");
  assert.ok(setPixelLine < clearLine, "the set-pixel should precede the clear");
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 1);
  assert.equal(lines.filter((line) => line === "port display clear").length, 1);
  // The clear tile is a sync host action, so it dispatches once and never awaits.
  assert.equal(lines.filter((line) => line.startsWith(`action ${clearHex} `)).length, 1);
  assert.equal(lines.filter((line) => line.endsWith(" async")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  // The clear blanked the lit pixel; the display ends dark.
  assert.equal(first.microbit.display.getPixelValue(0, 0), 0);
});
