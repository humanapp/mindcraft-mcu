/**
 * Golden for the user-code `ctx.getWhenResult()` accessor: real compiled brains
 * whose rule has a value-producing WHEN (a user sensor returning a number in one
 * variant, a buffer in the other) and a DO that reads that captured WHEN result
 * back from user code through `ctx.getWhenResult()`. Two call sites exercise the
 * same host accessor: an inline decoder sensor filling the driver actuator's
 * value slot (the sync HOST_CALL path -- the decoder's real call site) and the
 * driver actuator's own body. Each site narrows the returned `MindcraftValue`
 * (`typeof x === "number"` for the number WHEN, `Buffer.isBuffer(x)` for the
 * buffer WHEN) and drives the decoded byte onto a GPIO pin, so the exact value
 * captured at WHEN_END is observable past the port boundary from both a sensor
 * and an actuator. The serialized binary and rendered trace are pinned beside
 * this spec; the C++ VM parity test (cpp/test/trace-parity.test.cpp) loads the
 * same binary, replays the schedule, and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { type LinkedBrainProgram, linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter, observableTraceVmEvents } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

/** Pin the inline decoder sensor drives with its narrowed WHEN result. */
const SENSOR_PIN = 2;
/** Pin the driver actuator drives with the WHEN result it reads directly. */
const ACTUATOR_PIN = 3;

// How a variant's readers declare the WHEN-result type they consume. Each reader
// narrows both a Buffer and a Number at runtime, but declares the concrete type
// its producer actually delivers: a type name string, or the `BufferType` token.
interface WhenResultDecl {
  /** Extra import token prefixed to the `mindcraft` import (e.g. "BufferType, "). */
  imports: string;
  /** The `consumesWhenResult` value as written in source. */
  value: string;
}

const NUMBER_DECL: WhenResultDecl = { imports: "", value: '"number"' };
const BUFFER_DECL: WhenResultDecl = { imports: "BufferType, ", value: "BufferType" };

// The inline decoder sensor: reads the enclosing rule's WHEN result and narrows
// it. `Buffer.isBuffer` yields the first byte; a number passes through; anything
// else (nil, wrong type) yields the sentinel 99. Filling the driver's value slot
// makes this a sync HOST_CALL under a WHEN -- the decoder's real call site.
function decoderSource(decl: WhenResultDecl): string {
  return `import { ${decl.imports}Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-decoder",
  consumesWhenResult: ${decl.value},
  onExecute(ctx: Context): number {
    const result = ctx.getWhenResult();
    if (Buffer.isBuffer(result)) {
      return result.get(0);
    }
    if (typeof result === "number") {
      return result;
    }
    return 99;
  },
});
`;
}

// The driver actuator: writes the inline decoder's value (its anonymous number
// arg) to SENSOR_PIN, then reads the same WHEN result from its own body and
// writes the narrowed byte to ACTUATOR_PIN, exercising the accessor from an
// actuator call site alongside the sensor one.
function driverSource(decl: WhenResultDecl): string {
  return `import { ${decl.imports}Actuator, param, type Context } from "mindcraft";

export default Actuator({
  name: "when-driver",
  consumesWhenResult: ${decl.value},
  args: [param("value", { type: "number", anonymous: true })],
  onExecute(ctx: Context, args: { value: number }): void {
    ctx.microbit.gpio.digitalWrite(${SENSOR_PIN}, args.value);
    const result = ctx.getWhenResult();
    if (Buffer.isBuffer(result)) {
      ctx.microbit.gpio.digitalWrite(${ACTUATOR_PIN}, result.get(0));
    } else if (typeof result === "number") {
      ctx.microbit.gpio.digitalWrite(${ACTUATOR_PIN}, result);
    } else {
      ctx.microbit.gpio.digitalWrite(${ACTUATOR_PIN}, 99);
    }
  },
});
`;
}

/** One WHEN-result golden: fixture base name, the producer's WHEN value, and the decoded byte both pins carry. */
interface Variant {
  base: string;
  producerSource: string;
  /** The concrete WHEN-result type the readers declare, matching this variant's producer. */
  decl: WhenResultDecl;
  expected: number;
}

const VARIANTS: readonly Variant[] = [
  {
    base: "user-tile-when-result-number",
    producerSource: `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-producer",
  onExecute(ctx: Context): number {
    return 42;
  },
});
`,
    decl: NUMBER_DECL,
    expected: 42,
  },
  {
    base: "user-tile-when-result-buffer",
    producerSource: `import { BufferType, Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-producer",
  returnType: BufferType,
  onExecute(ctx: Context): Buffer {
    return Buffer.from([55, 7, 9]);
  },
});
`,
    decl: BUFFER_DECL,
    expected: 55,
  },
];

/** Two scheduled thinks: only the time advance (the brain ignores all input). */
const SCHEDULE: readonly number[] = [16, 16];

function fixturePath(base: string, extension: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${base}.${extension}`, import.meta.url));
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

/** Selects a bundle tile by the label the user source declared as its `name`. */
function findTile(tiles: readonly IBrainTileDef[], label: string): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.metadata?.label === label);
  assert.ok(tile, `tile '${label}' should be in the bundle`);
  return tile;
}

/** Compiles the variant's user code and builds the `producer -> driver(decoder)` rule. */
function buildImage(environment: MindcraftEnvironment, variant: Variant): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["when-producer.ts", variant.producerSource],
      ["when-decoder.ts", decoderSource(variant.decl)],
      ["when-driver.ts", driverSource(variant.decl)],
    ])
  );
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  for (const [path, entry] of compileResult.results) {
    assert.deepEqual(entry.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry.diagnostics)}`);
  }
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${variant.base} brain`);
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(findTile(bundle.tiles, "when-producer"));
  rule.do().appendTile(findTile(bundle.tiles, "when-driver"));
  rule.do().appendTile(findTile(bundle.tiles, "when-decoder"));

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
function ensureJsonGolden(variant: Variant): void {
  const jsonPath = fixturePath(variant.base, "mcprogram");
  if (existsSync(jsonPath)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment, variant);
  writeFileSync(
    jsonPath,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Runs the committed binary over the schedule with the GPIO write tap installed. */
function runTrace(bin: Uint8Array): { trace: string; microbit: MicroBit } {
  const environment = createMicroBitV2Environment();
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const decoded = parseWodalProgramImageBytes(
    bin,
    WodalDeviceProfileId.MICROBIT_V2,
    environment.brainServices.runtime.types
  );
  const writer = new ObservableTraceWriter({ profileId: profile.numericProfileId, precision: profile.numberPrecision });

  const microbit = new MicroBit();
  const deviceWrite = microbit.gpio.digitalWrite.bind(microbit.gpio);
  microbit.gpio.digitalWrite = (pin, value) => {
    writer.gpioDigitalWrite(pin, value);
    return deviceWrite(pin, value);
  };

  const vmEvents = observableTraceVmEvents(writer);
  const runtime = new WodalMicroBitRuntime({ environment, microbit, vmEvents });
  assert.deepEqual(runtime.loadWodalProgramImage(profile.createProgramImage(decoded.program)), { ok: true });

  let lastThinkTimeMs = 0;
  for (const [index, advanceMs] of SCHEDULE.entries()) {
    const timeMs = lastThinkTimeMs + advanceMs;
    writer.tick(index + 1, timeMs, lastThinkTimeMs === 0 ? 0 : timeMs - lastThinkTimeMs);
    runtime.tick(advanceMs);
    lastThinkTimeMs = timeMs;
  }
  return { trace: writer.render(), microbit };
}

for (const variant of VARIANTS) {
  test(`the committed ${variant.base} binary and observable trace golden are byte-stable`, () => {
    ensureJsonGolden(variant);
    const generated = wodalProgramBytes(new Uint8Array(readFileSync(fixturePath(variant.base, "mcprogram"))));
    const binPath = fixturePath(variant.base, "mcprogram.bin");
    if (!existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${variant.base}.mcprogram.bin is not byte-stable`);

    const first = runTrace(bin);
    const second = runTrace(bin);
    assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

    const lines = first.trace.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

    // Each think: the inline decoder narrowed the WHEN result and drove its byte
    // onto SENSOR_PIN, and the driver read the same result and drove it onto
    // ACTUATOR_PIN. Both carry the exact value captured at WHEN_END.
    assert.equal(
      lines.filter(
        (line) => line === `port gpio digital-write ${SENSOR_PIN.toString(16)} ${variant.expected.toString(16)}`
      ).length,
      SCHEDULE.length
    );
    assert.equal(
      lines.filter(
        (line) => line === `port gpio digital-write ${ACTUATOR_PIN.toString(16)} ${variant.expected.toString(16)}`
      ).length,
      SCHEDULE.length
    );

    const writes = first.microbit.gpio.recordedDigitalWrites();
    assert.equal(writes.length, SCHEDULE.length * 2);
    for (const write of writes.filter((entry) => entry.pin === SENSOR_PIN)) {
      assert.equal(write.value, variant.expected);
    }
    for (const write of writes.filter((entry) => entry.pin === ACTUATOR_PIN)) {
      assert.equal(write.value, variant.expected);
    }

    const tracePath = fixturePath(variant.base, "ticks.trace");
    if (!existsSync(tracePath)) {
      writeFileSync(tracePath, first.trace);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${variant.base}.ticks.trace is not byte-stable`);
  });
}

/** The parent rule's WHEN value. An own-WHEN inner rule must not read this; an empty-WHEN inner rule inherits it. */
const PARENT_WHEN_VALUE = 42;
/** The own-WHEN inner rule's own WHEN value. */
const CHILD_WHEN_VALUE = 7;

const PARENT_PRODUCER_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-parent-producer",
  onExecute(ctx: Context): number {
    return ${PARENT_WHEN_VALUE};
  },
});
`;

const CHILD_PRODUCER_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "when-child-producer",
  onExecute(ctx: Context): number {
    return ${CHILD_WHEN_VALUE};
  },
});
`;

/** One nested-rule golden: a parent rule (WHEN 42) with an inner rule whose DO reads the WHEN result. */
interface NestedVariant {
  base: string;
  /** The inner rule's WHEN producer source, or null for an empty inner WHEN (which captures no result). */
  childProducerSource: string | null;
  /** The decoded byte both inner call sites must carry. */
  expected: number;
  /** Description of which rule's WHEN result the inner call sites resolve to. */
  reads: string;
}

const NESTED_VARIANTS: readonly NestedVariant[] = [
  // The inner rule has its own WHEN (7): it captures and reads its own result, never the parent's 42.
  {
    base: "user-tile-when-result-nested",
    childProducerSource: CHILD_PRODUCER_SOURCE,
    expected: CHILD_WHEN_VALUE,
    reads: "its own WHEN result",
  },
  // The inner rule has no WHEN condition, so it captures no WHEN result. getWhenResult resolves
  // rule variables by walking the ancestor chain, so both inner call sites fall through to the
  // enclosing parent's captured result (42) on both VMs.
  {
    base: "user-tile-when-result-nested-empty",
    childProducerSource: null,
    expected: PARENT_WHEN_VALUE,
    reads: "the enclosing rule's WHEN result via ancestor fall-through",
  },
];

/** Compiles the nested user code and builds a parent rule (WHEN 42) with an inner rule per `variant`. */
function buildNestedImage(
  environment: MindcraftEnvironment,
  variant: NestedVariant
): WodalProgramImage<LinkedBrainProgram> {
  // The parent and child producers both deliver a Number, so the readers declare Number.
  const files = new Map<string, string>([
    ["when-parent-producer.ts", PARENT_PRODUCER_SOURCE],
    ["when-decoder.ts", decoderSource(NUMBER_DECL)],
    ["when-driver.ts", driverSource(NUMBER_DECL)],
  ]);
  if (variant.childProducerSource !== null) {
    files.set("when-child-producer.ts", variant.childProducerSource);
  }
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(files);
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  for (const [path, entry] of compileResult.results) {
    assert.deepEqual(entry.diagnostics, [], `Diagnostics for ${path}: ${JSON.stringify(entry.diagnostics)}`);
  }
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, `${variant.base} brain`);
  const parent = brainDef.pages().get(0)!.children().get(0)! as BrainRuleDef;
  parent.when().appendTile(findTile(bundle.tiles, "when-parent-producer"));
  const child = parent.appendNewRule();
  if (variant.childProducerSource !== null) {
    child.when().appendTile(findTile(bundle.tiles, "when-child-producer"));
  }
  child.do().appendTile(findTile(bundle.tiles, "when-driver"));
  child.do().appendTile(findTile(bundle.tiles, "when-decoder"));

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

for (const variant of NESTED_VARIANTS) {
  test(`the committed ${variant.base} binary and observable trace golden are byte-stable`, () => {
    const jsonPath = fixturePath(variant.base, "mcprogram");
    if (!existsSync(jsonPath)) {
      const environment = createMicroBitV2Environment();
      const image = buildNestedImage(environment, variant);
      writeFileSync(
        jsonPath,
        serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
      );
    }
    const generated = wodalProgramBytes(new Uint8Array(readFileSync(jsonPath)));
    const binPath = fixturePath(variant.base, "mcprogram.bin");
    if (!existsSync(binPath)) {
      writeFileSync(binPath, generated);
    }
    const bin = new Uint8Array(readFileSync(binPath));
    assert.deepEqual(bin, generated, `${variant.base}.mcprogram.bin is not byte-stable`);

    const first = runTrace(bin);
    const second = runTrace(bin);
    assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

    const lines = first.trace.split("\n");
    assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

    // Both inner-rule call sites resolve `variant.expected` -- for an own-WHEN inner
    // rule its own captured result, for an empty-WHEN inner rule the parent's result
    // reached by the ancestor-walk rule-variable resolution.
    const writes = first.microbit.gpio.recordedDigitalWrites();
    assert.ok(writes.length > 0, "the inner rule must fire and drive its decoded WHEN result");
    for (const write of writes) {
      assert.equal(write.value, variant.expected, `pin ${write.pin} must carry ${variant.reads}`);
    }
    assert.ok(
      writes.some((write) => write.pin === SENSOR_PIN),
      "the inner decoder (sensor call site) must drive SENSOR_PIN"
    );
    assert.ok(
      writes.some((write) => write.pin === ACTUATOR_PIN),
      "the inner driver (actuator call site) must drive ACTUATOR_PIN"
    );

    const tracePath = fixturePath(variant.base, "ticks.trace");
    if (!existsSync(tracePath)) {
      writeFileSync(tracePath, first.trace);
    }
    assert.equal(readFileSync(tracePath, "utf8"), first.trace, `${variant.base}.ticks.trace is not byte-stable`);
  });
}
