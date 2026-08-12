/**
 * Golden observable traces for the `otherwise` sensor: REAL compiled brains in
 * which one rule's WHEN is the firing outcome of the rule above it at its own
 * nesting level. Each rule marks itself by lighting its own display pixel, so a
 * trace block reads as the set of rules that fired that think.
 *
 * The family covers the complement pair over a toggled subject, a presence-gated
 * subject delivering a falsy value, a subject parked on an awaited actuator, a
 * three-level nested else-if ladder, a flat alternating run, an `otherwise` after
 * an empty-WHEN rule, `otherwise` composed into a larger WHEN expression, and a
 * page re-entry.
 *
 * Each brain is built through the tile API and compiled by the brain compiler.
 * The JSON, binary, and rendered trace are pinned beside this spec as the
 * cross-VM conformance fixtures: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads each binary, replays the same schedule,
 * and byte-compares the trace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BrainTileLiteralDef,
  CoreHostActions,
  CoreTypeIds,
  type HostActionIds,
  type MindcraftEnvironment,
  mkActuatorTileId,
  mkModifierTileId,
  mkParameterTileId,
  mkSensorTileId,
} from "@mindcraft-lang/core/app";
import { mkOperatorTileId } from "@mindcraft-lang/core/brain";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
import { type IncomingRadioPacket, RadioPacketType, radioNumberIsInteger } from "../../../core/radio";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { shouldWriteGolden } from "../../../mindcraft/golden-regeneration";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostActions, WodalMicroBitV2ModifierId, WodalMicroBitV2ParameterId } from "./tile-ids";

const BUTTON_A = MicroBitV2HostActions.ButtonA;
const BUTTON_B = MicroBitV2HostActions.ButtonB;
const RADIO_NUMBER = MicroBitV2HostActions.RadioReceiveNumber;
const HELD = WodalMicroBitV2ModifierId.Held;

/** Fixed metadata stamped on every injected packet; the tile sensor reads only the value. */
const INJECT_RSSI = -42;

/** Builds a number packet the way a real sender would. */
function numberPacket(value: number): IncomingRadioPacket {
  return {
    type: radioNumberIsInteger(value) ? RadioPacketType.Number : RadioPacketType.Double,
    group: 0,
    value,
    name: "",
    text: "",
    bytes: new Uint8Array(0),
    rssi: INJECT_RSSI,
    serial: 0,
    time: 0,
  };
}

/** The WHEN side of one rule in a fixture's tree. */
type WhenSpec =
  /** No WHEN condition: the rule fires every think it evaluates. */
  | { readonly kind: "empty" }
  /** A device sensor, optionally carrying a modifier tile. */
  | { readonly kind: "sensor"; readonly sensor: HostActionIds; readonly modifierId?: string }
  /** The bare `otherwise` sensor. */
  | { readonly kind: "otherwise" }
  /** `otherwise AND <sensor>`, exercising inline composition. */
  | { readonly kind: "otherwiseAnd"; readonly sensor: HostActionIds; readonly modifierId?: string };

/** One rule of a fixture's tree: its WHEN, its marker pixel, and its children. */
interface RuleSpec {
  readonly when: WhenSpec;
  /** Display coordinate this rule lights when it fires; omitted for a rule with an empty DO. */
  readonly pixel?: readonly [number, number];
  /** One-based page number this rule switches to when it fires. */
  readonly switchToPage?: number;
  readonly children?: readonly RuleSpec[];
}

/** One scheduled think: device input applied before the time advance, then the advance. */
interface ScheduleStep {
  readonly advanceMs: number;
  readonly a?: boolean;
  readonly b?: boolean;
  readonly inject?: readonly IncomingRadioPacket[];
}

/** One `otherwise` golden: its rule tree, its input schedule, and the pixels expected per think. */
interface OtherwiseFixture {
  readonly name: string;
  /** Root rules per page, in page order. */
  readonly pages: readonly (readonly RuleSpec[])[];
  readonly schedule: readonly ScheduleStep[];
  /**
   * The marker pixels expected in each think, as `[x, y]` pairs in trace order.
   * One entry per scheduled think; an empty entry means no rule marked that think.
   */
  readonly expectedPixels: readonly (readonly (readonly [number, number])[])[];
}

const sensorWhen = (sensor: HostActionIds, modifierId?: string): WhenSpec => ({
  kind: "sensor",
  sensor,
  modifierId,
});

const FIXTURES: readonly OtherwiseFixture[] = [
  {
    // The complement pair: exactly one of the two rules marks each think.
    name: "otherwise-pair",
    pages: [
      [
        { when: sensorWhen(BUTTON_A, HELD), pixel: [0, 0] },
        { when: { kind: "otherwise" }, pixel: [1, 0] },
      ],
    ],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, a: true },
      { advanceMs: 16 },
      { advanceMs: 16, a: false },
      { advanceMs: 16 },
    ],
    expectedPixels: [[[1, 0]], [[0, 0]], [[0, 0]], [[1, 0]], [[1, 0]]],
  },
  {
    // The case that forces the record: the subject is presence-gated, so a
    // delivered 0 -- falsy but present -- fires it and the complement stays quiet.
    name: "otherwise-presence-gated",
    pages: [
      [
        { when: sensorWhen(RADIO_NUMBER), pixel: [0, 0] },
        { when: { kind: "otherwise" }, pixel: [1, 0] },
      ],
    ],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, inject: [numberPacket(0)] },
      { advanceMs: 16 },
      { advanceMs: 16, inject: [numberPacket(9)] },
    ],
    expectedPixels: [[[1, 0]], [[0, 0]], [[1, 0]], [[0, 0]]],
  },
  {
    // A flat run alternates: each rule's subject is the one directly above it.
    name: "otherwise-alternating-run",
    pages: [
      [
        { when: sensorWhen(BUTTON_A, HELD), pixel: [0, 0] },
        { when: { kind: "otherwise" }, pixel: [1, 0] },
        { when: { kind: "otherwise" }, pixel: [2, 0] },
        { when: { kind: "otherwise" }, pixel: [3, 0] },
      ],
    ],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16, a: true }, { advanceMs: 16, a: false }],
    expectedPixels: [
      [
        [1, 0],
        [3, 0],
      ],
      [
        [0, 0],
        [2, 0],
      ],
      [
        [1, 0],
        [3, 0],
      ],
    ],
  },
  {
    // An empty WHEN fires every think, so the rule after it never fires.
    name: "otherwise-after-empty-when",
    pages: [
      [
        { when: { kind: "empty" }, pixel: [0, 0] },
        { when: { kind: "otherwise" }, pixel: [1, 0] },
      ],
    ],
    schedule: [{ advanceMs: 16 }, { advanceMs: 16 }, { advanceMs: 16 }],
    expectedPixels: [[[0, 0]], [[0, 0]], [[0, 0]]],
  },
  {
    // Inline composition: `otherwise AND button B held` fires only when both hold.
    name: "otherwise-in-expression",
    pages: [
      [
        { when: sensorWhen(BUTTON_A, HELD), pixel: [0, 0] },
        { when: { kind: "otherwiseAnd", sensor: BUTTON_B, modifierId: HELD }, pixel: [1, 0] },
      ],
    ],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, b: true },
      { advanceMs: 16, a: true },
      { advanceMs: 16, a: false },
      { advanceMs: 16, b: false },
    ],
    expectedPixels: [[], [[1, 0]], [[0, 0]], [[1, 0]], []],
  },
  {
    // A three-level else-if ladder: exactly one branch marks each think.
    name: "otherwise-ladder",
    pages: [
      [
        { when: sensorWhen(BUTTON_A, HELD), pixel: [0, 0] },
        {
          when: { kind: "otherwise" },
          children: [
            { when: sensorWhen(BUTTON_B, HELD), pixel: [1, 0] },
            {
              when: { kind: "otherwise" },
              children: [
                { when: sensorWhen(RADIO_NUMBER), pixel: [2, 0] },
                { when: { kind: "otherwise" }, pixel: [3, 0] },
              ],
            },
          ],
        },
      ],
    ],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, a: true },
      { advanceMs: 16, a: false, b: true },
      { advanceMs: 16, b: false, inject: [numberPacket(0)] },
      { advanceMs: 16 },
    ],
    expectedPixels: [[[3, 0]], [[0, 0]], [[1, 0]], [[2, 0]], [[3, 0]]],
  },
  {
    // Page re-entry: the complement is correct from the first think back on the
    // page, with no carry-over from the prior activation.
    name: "otherwise-page-reentry",
    pages: [
      [
        { when: sensorWhen(BUTTON_A, HELD), pixel: [0, 0] },
        { when: { kind: "otherwise" }, pixel: [1, 0] },
        { when: sensorWhen(BUTTON_B, HELD), switchToPage: 2 },
      ],
      [
        { when: { kind: "empty" }, pixel: [4, 4] },
        { when: { kind: "empty" }, switchToPage: 1 },
      ],
    ],
    schedule: [
      { advanceMs: 16 },
      { advanceMs: 16, b: true },
      { advanceMs: 16, b: false },
      { advanceMs: 16 },
      { advanceMs: 16, a: true },
      { advanceMs: 16, a: false },
    ],
    expectedPixels: [[[1, 0]], [[1, 0]], [[4, 4]], [[1, 0]], [[0, 0]], [[1, 0]]],
  },
];

/**
 * The parked-subject golden lives on its own: its subject awaits the display
 * scroll actuator, so the trace carries scroll lines the pixel-only fixtures do
 * not, and the schedule advances in scroll-sized steps.
 */
const PARKED_BASE = "otherwise-parked-subject";

function fixturePath(name: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}.${extension}`, import.meta.url));
}

/** Appends `set pixel` at `(x, y)` to `rule`'s DO, freezing the coordinates as literal tiles. */
function appendSetPixel(env: MindcraftEnvironment, brainDef: BrainDef, rule: BrainRuleDef, x: number, y: number): void {
  const tiles = env.brainServices.edit.tiles;
  const setPixel = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplaySetPixel.key));
  const xParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.X));
  const yParam = tiles.get(mkParameterTileId(WodalMicroBitV2ParameterId.Y));
  assert.ok(setPixel);
  assert.ok(xParam);
  assert.ok(yParam);
  rule.do().appendTile(setPixel);
  rule.do().appendTile(xParam);
  const xLiteral = new BrainTileLiteralDef(CoreTypeIds.Number, x, {}, env.brainServices);
  brainDef.catalog().registerTileDef(xLiteral);
  rule.do().appendTile(xLiteral);
  rule.do().appendTile(yParam);
  const yLiteral = new BrainTileLiteralDef(CoreTypeIds.Number, y, {}, env.brainServices);
  brainDef.catalog().registerTileDef(yLiteral);
  rule.do().appendTile(yLiteral);
}

/** Appends `switch page <pageNumber>` to `rule`'s DO. */
function appendSwitchPage(env: MindcraftEnvironment, brainDef: BrainDef, rule: BrainRuleDef, pageNumber: number): void {
  const switchPage = env.brainServices.edit.tiles.get(mkActuatorTileId(CoreHostActions.SwitchPage.key));
  assert.ok(switchPage);
  rule.do().appendTile(switchPage);
  const pageLiteral = new BrainTileLiteralDef(CoreTypeIds.Number, pageNumber, {}, env.brainServices);
  brainDef.catalog().registerTileDef(pageLiteral);
  rule.do().appendTile(pageLiteral);
}

/** Appends `spec`'s WHEN tiles to `rule`. */
function appendWhen(env: MindcraftEnvironment, rule: BrainRuleDef, spec: WhenSpec): void {
  const tiles = env.brainServices.edit.tiles;
  const appendSensor = (sensor: HostActionIds, modifierId?: string) => {
    const sensorTile = tiles.get(mkSensorTileId(sensor.key));
    assert.ok(sensorTile);
    rule.when().appendTile(sensorTile);
    if (modifierId !== undefined) {
      const modifierTile = tiles.get(mkModifierTileId(modifierId));
      assert.ok(modifierTile);
      rule.when().appendTile(modifierTile);
    }
  };
  const appendOtherwise = () => {
    const otherwiseTile = tiles.get(mkSensorTileId(CoreHostActions.Otherwise.key));
    assert.ok(otherwiseTile, "the otherwise sensor tile must be registered");
    rule.when().appendTile(otherwiseTile);
  };

  switch (spec.kind) {
    case "empty":
      return;
    case "sensor":
      appendSensor(spec.sensor, spec.modifierId);
      return;
    case "otherwise":
      appendOtherwise();
      return;
    case "otherwiseAnd": {
      appendOtherwise();
      const andTile = tiles.get(mkOperatorTileId("and"));
      assert.ok(andTile);
      rule.when().appendTile(andTile);
      appendSensor(spec.sensor, spec.modifierId);
      return;
    }
  }
}

/** Fills `rule` from `spec` and recursively appends its children. */
function fillRule(env: MindcraftEnvironment, brainDef: BrainDef, rule: BrainRuleDef, spec: RuleSpec): void {
  appendWhen(env, rule, spec.when);
  if (spec.pixel !== undefined) {
    appendSetPixel(env, brainDef, rule, spec.pixel[0], spec.pixel[1]);
  }
  if (spec.switchToPage !== undefined) {
    appendSwitchPage(env, brainDef, rule, spec.switchToPage);
  }
  for (const child of spec.children ?? []) {
    fillRule(env, brainDef, rule.appendNewRule(), child);
  }
}

/** Builds a fixture's brain: one page per entry, one root rule per `RuleSpec`. */
function buildBrainDef(env: MindcraftEnvironment, name: string, pages: readonly (readonly RuleSpec[])[]): BrainDef {
  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${name} brain`);
  for (let p = 0; p < pages.length; p++) {
    if (p > 0) {
      assert.ok(brainDef.appendNewPage().success);
    }
    const page = brainDef.pages().get(p)! as BrainPageDef;
    const specs = pages[p]!;
    for (let r = 0; r < specs.length; r++) {
      // Every page starts with one empty rule; later roots are appended.
      const rule = (r === 0 ? page.children().get(0)! : page.appendNewRule()) as BrainRuleDef;
      fillRule(env, brainDef, rule, specs[r]!);
    }
  }
  return brainDef;
}

function buildImage(env: MindcraftEnvironment, brainDef: BrainDef): WodalProgramImage<LinkedBrainProgram> {
  const built = buildWodalProgramImage({
    brainDef,
    environment: env,
    deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
  });
  if (!built.ok) {
    assert.fail(`expected a successful build: ${JSON.stringify(built.errors)}`);
  }
  return built.image;
}

/** Writes the JSON `.mcprogram` golden if missing, freezing the brain's generated ids. */
function ensureJsonGolden(jsonPath: string, build: (env: MindcraftEnvironment) => BrainDef): void {
  if (existsSync(jsonPath)) {
    return;
  }
  const env = createMicroBitV2Environment();
  const image = buildImage(env, build(env));
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** A loaded runtime with the observable-trace observer and the display-port tap installed. */
function loadTracedRuntime(bin: Uint8Array): {
  runtime: WodalMicroBitRuntime;
  writer: ObservableTraceWriter;
  microbit: MicroBit;
} {
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

  const microbit = new MicroBit();
  const deviceSetPixelValue = microbit.display.setPixelValue.bind(microbit.display);
  microbit.display.setPixelValue = (x, y, brightness) => {
    writer.displaySetPixel(x, y, brightness);
    deviceSetPixelValue(x, y, brightness);
  };

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });
  return { runtime, writer, microbit };
}

/** Runs a fixture binary over its schedule and renders the trace. */
function runFixtureTrace(fixture: OtherwiseFixture, bin: Uint8Array): string {
  const { runtime, writer, microbit } = loadTracedRuntime(bin);

  let lastThinkTimeMs = 0;
  for (const [index, step] of fixture.schedule.entries()) {
    if (step.a !== undefined) {
      microbit.setButtonPressed("A", step.a);
    }
    if (step.b !== undefined) {
      microbit.setButtonPressed("B", step.b);
    }
    for (const packet of step.inject ?? []) {
      microbit.radio.deliver(packet);
    }
    const timeMs = lastThinkTimeMs + step.advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(step.advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return writer.render();
}

/** The IEEE-754 f32 hex the trace renders `value` as. */
function f32Hex(value: number): string {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

/** The `[x, y]` marker pixels of each think, in trace order, one entry per tick. */
function pixelsPerTick(trace: string, tickCount: number): string[][] {
  const perTick: string[][] = [];
  for (let i = 0; i < tickCount; i++) {
    perTick.push([]);
  }
  let currentTick = 0;
  for (const line of trace.split("\n")) {
    if (line.startsWith("tick ")) {
      currentTick = Number.parseInt(line.split(" ")[1]!, 16);
    } else if (line.startsWith("port display set-pixel ")) {
      const parts = line.split(" ");
      perTick[currentTick - 1]!.push(`${parts[3]} ${parts[4]}`);
    }
  }
  return perTick;
}

/** The expected per-tick marker pixels rendered in the trace's hex form. */
function expectedPixelsAsHex(fixture: OtherwiseFixture): string[][] {
  return fixture.expectedPixels.map((tick) => tick.map(([x, y]) => `${f32Hex(x)} ${f32Hex(y)}`));
}

for (const fixture of FIXTURES) {
  test(`the committed ${fixture.name} binary and observable trace golden are byte-stable`, () => {
    assert.equal(
      fixture.expectedPixels.length,
      fixture.schedule.length,
      "every scheduled think needs its expected markers"
    );
    const jsonPath = fixturePath(fixture.name, "mcprogram");
    const binPath = fixturePath(fixture.name, "mcprogram.bin");
    const tracePath = fixturePath(fixture.name, "ticks.trace");

    ensureJsonGolden(jsonPath, (env) => buildBrainDef(env, fixture.name, fixture.pages));
    const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
    if (shouldWriteGolden(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${fixture.name}.mcprogram.bin is not byte-stable`);

    const first = runFixtureTrace(fixture, bin);
    const second = runFixtureTrace(fixture, bin);
    assert.equal(second, first, "two fresh runs must render byte-identical traces");

    const lines = first.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("tick ")).length, fixture.schedule.length);
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

    assert.deepEqual(pixelsPerTick(first, fixture.schedule.length), expectedPixelsAsHex(fixture));

    if (shouldWriteGolden(tracePath)) {
      writeFileSync(tracePath, first);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first, `${fixture.name}.ticks.trace is not byte-stable`);
  });
}

/**
 * A one-page brain whose subject rule scrolls text (an awaited actuator) while
 * button A is held, with an `otherwise` sibling that lights pixel (1,0). The
 * subject parks for the whole scroll, so its record keeps the fire it last
 * recorded and the complement stays quiet across the park; the complement
 * resumes only once the subject re-evaluates its WHEN with the button up.
 */
function buildParkedSubjectBrain(env: MindcraftEnvironment): BrainDef {
  const tiles = env.brainServices.edit.tiles;
  const buttonA = tiles.get(mkSensorTileId(BUTTON_A.key));
  const held = tiles.get(mkModifierTileId(HELD));
  const scroll = tiles.get(mkActuatorTileId(MicroBitV2HostActions.DisplayScroll.key));
  const otherwiseTile = tiles.get(mkSensorTileId(CoreHostActions.Otherwise.key));
  assert.ok(buttonA);
  assert.ok(held);
  assert.ok(scroll);
  assert.ok(otherwiseTile);

  const brainDef = BrainDef.emptyBrainDef(env.brainServices, `${PARKED_BASE} brain`);
  const page = brainDef.pages().get(0)! as BrainPageDef;

  const subject = page.children().get(0)! as BrainRuleDef;
  subject.when().appendTile(buttonA);
  subject.when().appendTile(held);
  subject.do().appendTile(scroll);

  const complement = page.appendNewRule() as BrainRuleDef;
  complement.when().appendTile(otherwiseTile);
  appendSetPixel(env, brainDef, complement, 1, 0);

  return brainDef;
}

test(`the committed ${PARKED_BASE} binary and observable trace golden are byte-stable`, () => {
  const jsonPath = fixturePath(PARKED_BASE, "mcprogram");
  const binPath = fixturePath(PARKED_BASE, "mcprogram.bin");
  const tracePath = fixturePath(PARKED_BASE, "ticks.trace");
  const tickCount = 10;
  const tickAdvanceMs = 1100;

  ensureJsonGolden(jsonPath, buildParkedSubjectBrain);
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
  if (shouldWriteGolden(binPath)) {
    writeFileSync(binPath, generated);
  }
  const bin = new Uint8Array(readFileSync(binPath));
  assert.deepEqual(bin, generated, `${PARKED_BASE}.mcprogram.bin is not byte-stable`);

  const run = (): string => {
    const { runtime, writer, microbit } = loadTracedRuntime(bin);
    const deviceScrollText = microbit.display.scrollText.bind(microbit.display);
    microbit.display.scrollText = (text, durationMs, requestTime, onComplete) => {
      if (!microbit.display.isBusy()) {
        writer.displayScroll(text);
      }
      deviceScrollText(text, durationMs, requestTime, onComplete);
    };

    let lastThinkTimeMs = 0;
    for (let i = 0; i < tickCount; i++) {
      // Button A goes down before think 2 and back up before think 6, so the
      // subject fires once, parks on its scroll, and re-evaluates later.
      if (i === 1) microbit.setButtonPressed("A", true);
      if (i === 4) microbit.setButtonPressed("A", false);
      const timeMs = lastThinkTimeMs + tickAdvanceMs;
      writer.tick(i + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
      runtime.tick(tickAdvanceMs);
      microbit.display.advanceScroll(timeMs);
      lastThinkTimeMs = timeMs;
    }
    return writer.render();
  };

  const first = run();
  assert.equal(run(), first, "two fresh runs must render byte-identical traces");

  const lines = first.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, tickCount);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);
  assert.ok(
    lines.some((line) => line.startsWith("port display scroll ")),
    "the subject must take the display for its awaited scroll"
  );

  // The complement marks think 1 (the subject has not fired yet) and stays quiet
  // for every think the subject holds its fire, including the whole park.
  // Think 1: the subject's condition does not hold, so the complement marks.
  // Think 2: the subject fires and parks on its awaited scroll. Thinks 3-7: the
  // subject is parked, its record still holds the fire it recorded, and the
  // complement stays quiet. Thinks 8-10: the scroll has completed, the subject
  // re-evaluates its WHEN with the button up, and the complement resumes.
  const marks = pixelsPerTick(first, tickCount).map((tick) => tick.length);
  assert.deepEqual(marks, [1, 0, 0, 0, 0, 0, 0, 1, 1, 1]);

  if (shouldWriteGolden(tracePath)) {
    writeFileSync(tracePath, first);
  }
  assert.equal(readFileSync(tracePath, "utf8"), first, `${PARKED_BASE}.ticks.trace is not byte-stable`);
});
