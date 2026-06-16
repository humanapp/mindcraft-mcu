/**
 * Golden observable trace for the committed user-tile button-display binary
 * fixture: a brain whose `when` reads `ctx.microbit.buttonA.isPressed()` and
 * whose `do` calls `ctx.microbit.display.setPixelValue(0, 0, 255)`, both through
 * native device structs reached from the injected context. Unlike the
 * host-action button-display golden, the device is driven by host functions and
 * bytecode actions, so the observable surface is the display device port alone
 * (no host-action dispatch lines). Drives the TS VM over a scripted button-A
 * schedule, taps the display port, and pins the rendered trace beside the
 * fixture. The C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the
 * same binary and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { VmEvents } from "@mindcraft-lang/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { parseWodalProgramImageBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-button-display.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-button-display.ticks.trace", import.meta.url));

/** One scheduled think: an optional button-A level applied before the time advance. */
interface ScheduleStep {
  /** Simulated milliseconds to advance before the think. */
  readonly advanceMs: number;

  /** When present, button A is set to this level before the time advance. */
  readonly buttonA?: boolean;
}

/**
 * Scripted button-A input for the committed trace golden, one entry per
 * scheduled think. The rule's condition is level-triggered (it fires every
 * think the button is held, not on the edge), so the schedule lights the pixel
 * on the two held ticks and leaves it dark on the released ticks.
 *
 * The C++ VM parity test (cpp/test/trace-parity.test.cpp) embeds this same
 * schedule in code; the two copies are kept in sync by hand, and a divergence
 * fails the golden trace byte-comparison.
 */
const HELD_PIXEL_SCHEDULE: readonly ScheduleStep[] = [
  { advanceMs: 16 }, // released: condition false, no write
  { advanceMs: 16, buttonA: true }, // held: condition true, lights the pixel
  { advanceMs: 16 }, // still held: level-triggered, lights it again
  { advanceMs: 16, buttonA: false }, // released: condition false, no write
];

/** Runs the committed user-tile binary over the schedule with the display-port tap installed. */
function runUserTileTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
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

  // Device-port tap: record each pixel write as it crosses the display port.
  const microbit = new MicroBit();
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
  for (const [index, step] of HELD_PIXEL_SCHEDULE.entries()) {
    if (step.buttonA !== undefined) {
      microbit.setButtonPressed("A", step.buttonA);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed user-tile observable trace golden is byte-stable", () => {
  const bin = new Uint8Array(readFileSync(BIN_PATH));

  const first = runUserTileTrace(bin);
  const second = runUserTileTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  // The trace shows every scheduled think, a pixel write on each of the two held
  // ticks and none on the released ticks, and no faults; the device ends lit.
  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, HELD_PIXEL_SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(
    readFileSync(TRACE_PATH, "utf8"),
    first.trace,
    "user-tile-button-display.ticks.trace is not byte-stable"
  );
});
