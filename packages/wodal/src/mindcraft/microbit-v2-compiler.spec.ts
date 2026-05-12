import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Dict, List, UniqueSet } from "@mindcraft-lang/core";
import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import {
  BYTECODE_VERSION,
  type LinkedBrainProgram,
  Op,
  type PageMetadata,
  type Program,
  VmStatus,
  VOID_VALUE,
} from "@mindcraft-lang/core/runtime";
import {
  type AmbientFile,
  buildCompiledActionBundle,
  compileUserTile,
  type ProjectCompileResult,
  type UserAuthoredProgram,
  UserTileProject,
} from "@mindcraft-lang/ts-compiler";
import { MicroBit } from "../microbit-v2";
import { MISSING_WODAL_PROGRAM, WodalError } from "../wodal-error";
import { createMicroBitV2Module } from "./microbit-v2-module";
import { WodalMicroBitRuntime } from "./microbit-v2-runtime";

test("compiled Mindcraft code routes display calls through WODAL MicroBitDisplay", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const program = compileDisplayActuator(environment, { brightness: 255, x: 1, y: 2 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(runtime.loadImage({ version: 1, program }), { ok: true, errors: [] });
  const result = runtime.tick(16);

  assert.equal(result?.status, VmStatus.DONE);
  const display = runtime.snapshot().display;
  assert.equal(runtime.snapshot().time, 16);
  assert.equal(display.pixels[2 * display.width + 1], 255);
});

test("compiled Mindcraft code reads WODAL Button state", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const program = compileButtonDisplayActuator(environment, { brightness: 128, x: 2, y: 3 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(runtime.loadImage({ version: 1, program }), { ok: true, errors: [] });
  assert.equal(runtime.tick(16)?.status, VmStatus.DONE);
  assert.equal(runtime.snapshot().display.pixels[3 * runtime.snapshot().display.width + 2], 0);

  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16)?.status, VmStatus.DONE);

  const display = runtime.snapshot().display;
  assert.equal(display.pixels[3 * display.width + 2], 128);
});

test("WodalMicroBitRuntime reports missing loaded program with a stable code", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const runtime = new WodalMicroBitRuntime({ environment });

  assert.throws(
    () => runtime.tick(16),
    (error) => error instanceof WodalError && error.code === MISSING_WODAL_PROGRAM
  );
  assert.equal(runtime.snapshot().time, 0);
});

test("WodalMicroBitRuntime keeps the active program when image validation fails", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const runtime = new WodalMicroBitRuntime({ environment });
  const firstProgram = compileDisplayActuator(environment, { brightness: 111, x: 0, y: 0 });
  const secondProgram = compileDisplayActuator(environment, { brightness: 222, x: 4, y: 4 });

  assert.deepEqual(runtime.loadImage({ version: 1, program: firstProgram }), { ok: true, errors: [] });
  assert.equal(runtime.tick(10)?.status, VmStatus.DONE);

  runtime.microbit.display.clear();
  const validation = runtime.loadImage({ version: 65536, program: null });
  assert.equal(validation.ok, false);
  assert.equal(runtime.tick(10)?.status, VmStatus.DONE);
  assert.equal(runtime.snapshot().time, 20);
  assert.equal(runtime.snapshot().display.pixels[0], 111);

  runtime.microbit.display.clear();
  assert.deepEqual(runtime.loadImage({ version: 1, program: secondProgram }), { ok: true, errors: [] });
  assert.equal(runtime.tick(10)?.status, VmStatus.DONE);
  assert.equal(runtime.snapshot().time, 30);
  const display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 0);
  assert.equal(display.pixels[4 * display.width + 4], 222);
});

test("WodalMicroBitRuntime loads linked brain images through core BrainRuntime", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const runtime = new WodalMicroBitRuntime({ environment });
  const linkedBrain = createLinkedBrainProgram();

  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: linkedBrain }), { ok: true, errors: [] });
  const result = runtime.tick(25);

  assert.equal(result, undefined);
  assert.equal(runtime.snapshot().time, 25);
});

test("linked brain root rules route display calls through WODAL MicroBitDisplay", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const program = compileDisplayActuator(environment, { brightness: 77, x: 3, y: 1 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createLinkedBrainProgram(program, [program.entryFuncId]);

  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: linkedBrain }), { ok: true, errors: [] });
  const result = runtime.tick(16);

  assert.equal(result, undefined);
  const display = runtime.snapshot().display;
  assert.equal(runtime.snapshot().time, 16);
  assert.equal(display.pixels[1 * display.width + 3], 77);
});

test("test-only bundled brain runs WHEN button A pressed DO display actuator", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createTestOnlyButtonDisplayBrain(environment);

  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: linkedBrain }), { ok: true, errors: [] });
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 0);

  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);

  assert.equal(runtime.snapshot().display.pixels[0], 201);
});

test("WodalMicroBitRuntime replaces active linked brain images", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const firstBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 31, x: 0, y: 0 });
  const secondBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 202, x: 1, y: 0 });

  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: firstBrain }), { ok: true, errors: [] });
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 31);

  microbit.display.clear();
  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: secondBrain }), { ok: true, errors: [] });
  assert.equal(runtime.tick(16), undefined);

  const display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 0);
  assert.equal(display.pixels[1], 202);
});

test("WodalMicroBitRuntime keeps active linked brain when brain image validation fails", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 61, x: 0, y: 0 });

  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: linkedBrain }), { ok: true, errors: [] });
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 61);

  microbit.display.clear();
  const validation = runtime.loadBrainImage({ version: 65536, program: null as unknown as LinkedBrainProgram });
  assert.equal(validation.ok, false);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 61);
});

test("WodalMicroBitRuntime keeps action artifacts and linked brains mutually exclusive", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 211, x: 0, y: 0 });
  const program = compileDisplayActuator(environment, { brightness: 99, x: 4, y: 4 });

  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: linkedBrain }), { ok: true, errors: [] });
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 211);

  microbit.display.clear();
  assert.deepEqual(runtime.loadImage({ version: 1, program }), { ok: true, errors: [] });
  assert.equal(runtime.tick(16)?.status, VmStatus.DONE);
  let display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 0);
  assert.equal(display.pixels[4 * display.width + 4], 99);

  microbit.display.clear();
  assert.deepEqual(runtime.loadBrainImage({ version: 1, program: linkedBrain }), { ok: true, errors: [] });
  assert.equal(runtime.tick(16), undefined);
  display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 211);
  assert.equal(display.pixels[4 * display.width + 4], 0);
});

interface DisplayActuatorOptions {
  readonly brightness: number;
  readonly x: number;
  readonly y: number;
}

function compileDisplayActuator(
  environment: MindcraftEnvironment,
  options: DisplayActuatorOptions
): UserAuthoredProgram {
  const result = compileUserTile(
    `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(${options.x}, ${options.y}, ${options.brightness});
  },
});
`,
    { ambientFiles: wodalAmbientFiles(), services: environment.brainServices }
  );

  assert.deepEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);
  return result.program;
}

function compileButtonDisplayActuator(
  environment: MindcraftEnvironment,
  options: DisplayActuatorOptions
): UserAuthoredProgram {
  const result = compileUserTile(
    `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "set-display-pixel-when-button-a-pressed",
  onExecute(ctx: Context): void {
    if (ctx.microbit.buttonA.isPressed()) {
      ctx.microbit.display.setPixelValue(${options.x}, ${options.y}, ${options.brightness});
    }
  },
});
`,
    { ambientFiles: wodalAmbientFiles(), services: environment.brainServices }
  );

  assert.deepEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);
  return result.program;
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    { path: "mindcraft.microbit-v2.d.ts", content: readText("../../ambient/mindcraft.microbit-v2.d.ts") },
  ];
}

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function createTestOnlyButtonDisplayBrain(
  environment: MindcraftEnvironment,
  options: DisplayActuatorOptions = { brightness: 201, x: 0, y: 0 }
): LinkedBrainProgram {
  const bundle = compileTestOnlyButtonDisplayBundle(environment, options);
  environment.replaceActionBundle(bundle);

  const sensorTile = findBundleTile(bundle.tiles, "sensor");
  const actuatorTile = findBundleTile(bundle.tiles, "actuator");
  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "test-only button display brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);

  const brain = environment.createBrain(brainDef);
  const program = brain.getProgram();
  assert.ok(program);
  const linkedBrain: LinkedBrainProgram = {
    program,
    ruleIndex: new Dict<string, number>(),
    pages: brain.getPages(),
  };
  brain.dispose();
  return linkedBrain;
}

function compileTestOnlyButtonDisplayBundle(environment: MindcraftEnvironment, options: DisplayActuatorOptions) {
  const project = new UserTileProject({ ambientFiles: wodalAmbientFiles(), services: environment.brainServices });
  project.setFiles(
    new Map([
      [
        "button-a-pressed.ts",
        `
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "test-button-a-pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
`,
      ],
      [
        "set-display-pixel.ts",
        `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "test-set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(${options.x}, ${options.y}, ${options.brightness});
  },
});
`,
      ],
    ])
  );
  const compileResult = project.compileAll();
  assertProjectCompiled(compileResult);
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  return bundle;
}

function assertProjectCompiled(result: ProjectCompileResult): void {
  assert.equal(result.tsErrors.size, 0, `Unexpected TypeScript diagnostics: ${JSON.stringify([...result.tsErrors])}`);
  for (const [path, compileResult] of result.results) {
    assert.deepEqual(
      compileResult.diagnostics,
      [],
      `Unexpected compiler diagnostics for ${path}: ${JSON.stringify(compileResult.diagnostics)}`
    );
    assert.ok(compileResult.program, `Expected compiled program for ${path}`);
  }
}

function findBundleTile(tiles: readonly IBrainTileDef[], kind: "actuator" | "sensor"): IBrainTileDef {
  const tile = tiles.find((candidate) => candidate.kind === kind);
  assert.ok(tile);
  return tile;
}

function createLinkedBrainProgram(
  program: Program = createNoopProgram(),
  rootRuleFuncIds: readonly number[] = [0]
): LinkedBrainProgram {
  const page: PageMetadata = {
    pageIndex: 0,
    pageId: "page-1-id",
    pageName: "page-1",
    rootRuleFuncIds: List.from(rootRuleFuncIds),
    actionCallSites: List.empty(),
    sensors: new UniqueSet<string>(),
    actuators: new UniqueSet<string>(),
  };
  return {
    program,
    ruleIndex: createRuleIndex(rootRuleFuncIds),
    pages: List.from([page]),
  };
}

function createNoopProgram(): Program {
  return {
    version: BYTECODE_VERSION,
    functions: List.from([{ code: List.from([{ op: Op.PUSH_CONST_VAL, a: 0 }, { op: Op.RET }]), numParams: 0 }]),
    constantPools: {
      numbers: List.empty<number>(),
      strings: List.empty<string>(),
      values: List.from([VOID_VALUE]),
    },
    variableNames: List.empty<string>(),
  };
}

function createRuleIndex(rootRuleFuncIds: readonly number[]): Dict<string, number> {
  const ruleIndex = new Dict<string, number>();
  for (let i = 0; i < rootRuleFuncIds.length; i++) {
    ruleIndex.set(`page-1/${i}`, rootRuleFuncIds[i]!);
  }
  return ruleIndex;
}
