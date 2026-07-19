/**
 * Golden observable trace for rule-variable inheritance across a plain function
 * call, exercised through a real user-tile TS program. The actuator seeds a rule
 * variable, calls a non-actuator helper function that reads that variable and
 * writes a second one through the calling rule's store, then reads the helper's
 * write back and surfaces both values by writing them to an I2C address. A VM
 * that did not forward the calling rule into the helper frame would read nil and
 * diverge on both surfaced values. The rule-context host calls are emitted by
 * real expression compilation (the ts-compiler), not hand-authored. The
 * serialized binary and its rendered trace are pinned beside this spec as the
 * cross-VM conformance fixture: the C++ VM parity test
 * (cpp/test/trace-parity.test.cpp) loads the same binary, replays the schedule,
 * and byte-compares.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  CoreFuncId,
  type LinkedBrainProgram,
  linkedBrainProgramToJson,
  Op,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { serializeWodalProgramImageJson, type WodalProgramImage } from "../../../mindcraft/program-image";
import { parseWodalProgramImageBytes, wodalProgramBytes } from "../../../mindcraft/program-image-binary";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { ObservableTraceWriter } from "./observable-trace";
import { WodalMicroBitRuntime } from "./runtime";

const JSON_PATH = fileURLToPath(new URL("./__fixtures__/rule-helper-variables.mcprogram", import.meta.url));
const BIN_PATH = fileURLToPath(new URL("./__fixtures__/rule-helper-variables.mcprogram.bin", import.meta.url));
const TRACE_PATH = fileURLToPath(new URL("./__fixtures__/rule-helper-variables.ticks.trace", import.meta.url));

/** I2C address the packed-result buffer is written to each think. */
const PROBE_ADDRESS = 0x10;

/** Bytes of the packed result buffer: the helper's inherited read (77) and the rule's read-back of the helper's write (88). */
const PROBE_HEX = "4d58";

// A trigger that fires every think, so the actuator runs each tick.
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-always",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() >= 0;
  },
});
`;

// Seeds a rule variable, then a helper reads it and writes another through the
// calling rule's store; the rule reads the helper's write back and surfaces both.
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

function readSeedWriteResult(ctx: Context): number {
  const seed = ctx.rule.getVariable("seed");
  ctx.rule.setVariable("fromHelper", 88);
  return typeof seed === "number" ? seed : 0;
}

export default Actuator({
  name: "user-rule-helper",
  onExecute(ctx: Context): void {
    ctx.rule.setVariable("seed", 77);
    const inherited = readSeedWriteResult(ctx);
    const back = ctx.rule.getVariable("fromHelper");
    ctx.microbit.i2c.writeBuffer(0x10, Buffer.from([inherited, typeof back === "number" ? back : 0]));
  },
});
`;

/** One scheduled think per entry: only the time advance (the brain ignores all input). */
const SCHEDULE: readonly number[] = [16, 16];

/** Opcodes the real compile must emit: the rule-context host calls and the helper-function call. */
const REQUIRED_OPCODES: readonly { op: number; a?: number }[] = [
  { op: Op.HOST_CALL, a: CoreFuncId.RuleContextGetVariable },
  { op: Op.HOST_CALL, a: CoreFuncId.RuleContextSetVariable },
  { op: Op.CALL },
];

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

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

/** Compiles the user tiles, installs them, and builds the trigger -> rule-helper rule. */
function buildImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-always.ts", SENSOR_SOURCE],
      ["user-rule-helper.ts", ACTUATOR_SOURCE],
    ])
  );
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile rule helper brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(findBundleTile(bundle.tiles, "sensor"));
  rule.do().appendTile(findBundleTile(bundle.tiles, "actuator"));

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
function ensureJsonGolden(): void {
  if (existsSync(JSON_PATH)) {
    return;
  }
  const environment = createMicroBitV2Environment();
  const image = buildImage(environment);
  writeFileSync(
    JSON_PATH,
    serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) })
  );
}

/** Runs the committed binary over the schedule with the I2C-port tap installed. */
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
  const deviceWrite = microbit.i2c.write.bind(microbit.i2c);
  microbit.i2c.write = (address, data) => {
    writer.i2cWrite(address, data);
    return deviceWrite(address, data);
  };

  const vmEvents: VmEvents = { onFiberFault: (payload) => writer.fiberFault(payload.fiberId, payload.err.code) };
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

test("the committed rule-helper-variables binary and observable trace golden are byte-stable", () => {
  ensureJsonGolden();
  const generated = wodalProgramBytes(new Uint8Array(readFileSync(JSON_PATH)));
  if (!existsSync(BIN_PATH)) {
    writeFileSync(BIN_PATH, generated);
  }
  const bin = new Uint8Array(readFileSync(BIN_PATH));
  assert.deepEqual(bin, generated, "rule-helper-variables.mcprogram.bin is not byte-stable");

  // Real expression compilation emits the rule-context calls and helper call this fixture pins.
  const golden = JSON.parse(readFileSync(JSON_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number; a?: number }[] }[] } };
  };
  const seen = golden.program.program.functions.flatMap((fn) => fn.code);
  for (const required of REQUIRED_OPCODES) {
    assert.ok(
      seen.some((ins) => ins.op === required.op && (required.a === undefined || ins.a === required.a)),
      `compiled bytecode should carry op ${required.op}${required.a === undefined ? "" : ` func ${required.a}`}`
    );
  }

  const first = runTrace(bin);
  const second = runTrace(bin);
  assert.equal(second.trace, first.trace, "two fresh runs must render byte-identical traces");

  const lines = first.trace.split("\n");
  assert.equal(lines.filter((line) => line.startsWith("tick ")).length, SCHEDULE.length);
  // One packed result buffer written per think, no host-action lines, no faults.
  assert.equal(lines.filter((line) => line.startsWith("port i2c write ")).length, SCHEDULE.length);
  assert.equal(lines.filter((line) => line.startsWith("action ")).length, 0);
  assert.equal(lines.filter((line) => line.startsWith("fault ")).length, 0);

  // The injectable bus records the inherited read and the helper's write read back.
  const writes = first.microbit.i2c.recordedWrites();
  assert.equal(writes.length, SCHEDULE.length);
  for (const write of writes) {
    assert.equal(write.address, PROBE_ADDRESS);
    assert.equal(
      Array.from(write.bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      PROBE_HEX
    );
  }

  if (!existsSync(TRACE_PATH)) {
    writeFileSync(TRACE_PATH, first.trace);
  }
  assert.equal(readFileSync(TRACE_PATH, "utf8"), first.trace, "rule-helper-variables.ticks.trace is not byte-stable");
});
