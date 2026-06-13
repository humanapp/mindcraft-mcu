/**
 * Golden observable trace for the committed button-display binary fixture.
 * Drives the TS VM over a scripted button-A schedule, taps the host-binding
 * surface (action dispatch, the display device port, fiber faults), and pins
 * the rendered trace beside the fixture via write-if-missing + byte-stable.
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
import { MicroBitV2HostActions } from "./tile-ids";

const BIN_PATH = fileURLToPath(new URL("./__fixtures__/button-display.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/button-display.press-cycles.trace", import.meta.url));

/** One scheduled think: an optional button-A level applied before the time advance. */
interface ScheduleStep {
  /** Simulated milliseconds to advance before the think. */
  readonly advanceMs: number;

  /** When present, button A is set to this level before the time advance. */
  readonly buttonA?: boolean;
}

/**
 * Scripted button-A input for the committed trace golden, one entry per
 * scheduled think. The schedule exercises the button sensor's callsite-state
 * lifecycle: baseline seeding on the first evaluation, the
 * released-to-pressed edge, a hold with no re-trigger, the release, and a
 * second press after the release.
 *
 * The C++ VM parity test (cpp/test/trace-parity.test.cpp) embeds this same
 * schedule in code; the two copies are kept in sync by hand, and a
 * divergence fails the golden trace byte-comparison.
 */
const PRESS_CYCLES_SCHEDULE: readonly ScheduleStep[] = [
  { advanceMs: 16 }, // first eval seeds callsite state, no edge
  { advanceMs: 16 }, // steady released
  { advanceMs: 32, buttonA: true }, // released-to-pressed edge fires the rule
  { advanceMs: 16 }, // held: edge detection does not re-trigger
  { advanceMs: 16 }, // still held
  { advanceMs: 48, buttonA: false }, // release: not reported by the default modifier
  { advanceMs: 16 }, // steady released
  { advanceMs: 32, buttonA: true }, // second press edge fires the rule again
  { advanceMs: 16, buttonA: false }, // release again
  { advanceMs: 16 }, // steady released
];

/**
 * Runs the committed button-display binary golden over the press-cycles
 * schedule with the observable-trace taps installed and returns the rendered
 * trace plus the device for end-state assertions.
 */
function runPressCyclesTrace(): { trace: string; microbit: MicroBit } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    new Uint8Array(readFileSync(BIN_PATH)),
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({
    profileId: profile.numericProfileId,
    precision: profile.numberPrecision,
  });

  // Binding-table tap: wrap the registered sync exec of each host action the
  // fixture dispatches, recording the dispatch as the binding observes it.
  const actions = environment.brainServices.runtime.actions;
  for (const { actionId } of [MicroBitV2HostActions.ButtonA, MicroBitV2HostActions.DisplaySetPixel]) {
    const action = actions.getById(actionId);
    assert.ok(action !== undefined && action.binding === "host");
    const exec = action.execSync;
    assert.ok(exec !== undefined);
    action.execSync = (ctx, args) => {
      const result = exec(ctx, args);
      const callSiteId = ctx.currentCallSiteId;
      assert.ok(callSiteId !== undefined);
      writer.hostActionCall(actionId, callSiteId, args, result);
      return result;
    };
  }

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
  for (const [index, step] of PRESS_CYCLES_SCHEDULE.entries()) {
    if (step.buttonA !== undefined) {
      microbit.setButtonPressed("A", step.buttonA);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    // Mirrors BrainRuntime.think's dt stamping: dt stays 0 until a prior think exists.
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

test("the committed press-cycles observable trace golden is byte-stable", () => {
  const first = runPressCyclesTrace();
  const second = runPressCyclesTrace();
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  // The trace must show every scheduled think, the rule firing exactly on the
  // two press-edge ticks, and no faults; the device must end with pixel (0,0) lit.
  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, PRESS_CYCLES_SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("port display set-pixel ")).length, 2);
  assert.equal(lines.filter((line) => /^action 400 .+ result bool 1$/.test(line)).length, 2);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.equal(first.microbit.display.getPixelValue(0, 0), 255);

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "button-display.press-cycles.trace is not byte-stable");
});
