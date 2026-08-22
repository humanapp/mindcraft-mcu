/**
 * Golden observable trace for the committed button-display binary fixture.
 * Drives the TS VM over a scripted button-A schedule, observes the host-binding
 * surface (action dispatch, the display device port, fiber faults), and pins
 * the rendered trace beside the fixture via write-if-missing + byte-stable.
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { List } from "@wendoo/core";
import { mkFunctionValue, NativeType, type Value } from "@wendoo/core/runtime";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../wendoo/device-profile";
import { shouldWriteGolden } from "../../../wendoo/golden-regeneration";
import { parseWodalProgramImageBytes } from "../../../wendoo/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

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
 * scheduled think. The sensor reports its default `pressed` event (the
 * released-to-pressed edge). The schedule exercises the callsite-state
 * lifecycle: baseline seeding, a press edge that fires, a hold with no
 * re-trigger, the release (not reported), then a second press edge that fires.
 *
 * The C++ VM parity test (cpp/test/trace-parity.test.cpp) embeds this same
 * schedule in code; the two copies are kept in sync by hand, and a
 * divergence fails the golden trace byte-comparison.
 */
const PRESS_CYCLES_SCHEDULE: readonly ScheduleStep[] = [
  { advanceMs: 16 }, // first eval seeds callsite state, no edge
  { advanceMs: 16 }, // steady released
  { advanceMs: 32, buttonA: true }, // press edge fires the rule
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
 * schedule with the observable-trace observers installed and returns the rendered
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

  // Device-port tap: record each pixel write as it crosses the display port.
  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents: observableTraceVmEvents(writer) });
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

  if (shouldWriteGolden(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "button-display.press-cycles.trace is not byte-stable");
});

/** An enum value of the program-local type `mode` holding `symbol`. */
function enumValue(symbol: string): Value {
  return { t: NativeType.Enum, typeId: "mode", v: symbol };
}

test("an enum value renders its symbol name", () => {
  const writer = new ObservableTraceWriter({ profileId: 0, precision: "f32" });
  writer.hostActionCall(2, 0, List.from([enumValue("Stop")]), enumValue("Go"));

  assert.equal(writer.render().split("\n")[3], 'action 2 site 0 args 1 enum "Stop" result enum "Go"');
});

test("a value kind outside the trace vocabulary renders opaque and never throws", () => {
  const writer = new ObservableTraceWriter({ profileId: 0, precision: "f32" });
  writer.hostActionCall(1, 0, List.from([mkFunctionValue(0)]), mkFunctionValue(1));

  assert.equal(writer.render().split("\n")[3], "action 1 site 0 args 1 opaque result opaque");
});

test("a bytecode-bound dispatch renders a tile line", () => {
  const writer = new ObservableTraceWriter({ profileId: 0, precision: "f32" });
  writer.bytecodeActionCall(3, 5, List.from([enumValue("Go")]), mkFunctionValue(0));
  writer.bytecodeActionCallAsync(4, 6, List.empty<Value>());

  const lines = writer.render().split("\n");
  assert.equal(lines[3], 'tile 3 site 5 args 1 enum "Go" result opaque');
  assert.equal(lines[4], "tile 4 site 6 args 0 async");
});
