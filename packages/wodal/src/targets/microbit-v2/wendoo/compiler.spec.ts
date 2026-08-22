import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Dict, List } from "@wendoo-lang/core";
import type { WendooEnvironment } from "@wendoo-lang/core/app";
import type { IBrainTileDef } from "@wendoo-lang/core/brain";
import { BrainDef } from "@wendoo-lang/core/brain/model";
import {
  BYTECODE_VERSION,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  Op,
  type PageMetadata,
  type Program,
  VOID_VALUE,
} from "@wendoo-lang/core/runtime";
import { WENDOO_PROGRAM_IMAGE_FORMAT, WENDOO_PROGRAM_IMAGE_VERSION } from "@wendoo-lang/service-api";
import {
  type AmbientFile,
  buildCompiledActionBundle,
  compileUserTile,
  type ProjectCompileResult,
  type UserAuthoredProgram,
  UserTileProject,
} from "@wendoo-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@wendoo-lang/ts-compiler/testing";
import { WodalDeviceProfileId } from "../../../wendoo/device-profile";
import type { WodalProgramImage } from "../../../wendoo/program-image";
import { WodalProgramLoadValidationCode } from "../../../wendoo/program-load";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { createMicroBitV2ProgramImage } from "./program-image";
import { WodalMicroBitRuntime } from "./runtime";

test("compiled Wendoo code routes display calls through WODAL MicroBitDisplay", () => {
  const environment = createMicroBitV2Environment();
  const program = compileDisplayActuator(environment, { brightness: 255, x: 1, y: 2 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(
    runtime.loadWodalProgramImage(
      createMicroBitV2ProgramImage(createLinkedBrainProgram(program, [program.entryFuncId]))
    ),
    { ok: true }
  );
  runtime.tick(16);

  const display = runtime.snapshot().display;
  assert.equal(runtime.snapshot().time, 16);
  assert.equal(display.pixels[2 * display.width + 1], 255);
});

test("compiled Wendoo code reads WODAL Button state", () => {
  const environment = createMicroBitV2Environment();
  const program = compileButtonDisplayActuator(environment, { brightness: 128, x: 2, y: 3 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(
    runtime.loadWodalProgramImage(
      createMicroBitV2ProgramImage(createLinkedBrainProgram(program, [program.entryFuncId]))
    ),
    { ok: true }
  );
  runtime.tick(16);
  assert.equal(runtime.snapshot().display.pixels[3 * runtime.snapshot().display.width + 2], 0);

  microbit.setButtonPressed("A", true);
  runtime.tick(16);

  const display = runtime.snapshot().display;
  assert.equal(display.pixels[3 * display.width + 2], 128);
});

test("WodalMicroBitRuntime tick is a no-op when no program is loaded", () => {
  const environment = createMicroBitV2Environment();
  const runtime = new WodalMicroBitRuntime({ environment });

  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().time, 0);
});

test("WodalMicroBitRuntime unload stops the program and resets the device", () => {
  const environment = createMicroBitV2Environment();
  const program = compileDisplayActuator(environment, { brightness: 255, x: 1, y: 2 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(createLinkedBrainProgram(program, [program.entryFuncId])));
  runtime.tick(16);
  const litDisplay = runtime.snapshot().display;
  assert.equal(litDisplay.pixels[2 * litDisplay.width + 1], 255);
  assert.equal(runtime.snapshot().time, 16);

  runtime.unload();

  // After unload the device is reset: the lit pixel clears and time returns to zero.
  const reset = runtime.snapshot();
  assert.equal(reset.display.pixels[2 * reset.display.width + 1], 0);
  assert.equal(reset.time, 0);

  // Tick is a no-op once unloaded: device time does not advance.
  runtime.tick(16);
  assert.equal(runtime.snapshot().time, 0);
});

test("WodalMicroBitRuntime reload resets the device so a prior program's display does not persist", () => {
  const environment = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  const programA = compileDisplayActuator(environment, { brightness: 255, x: 1, y: 2 });
  runtime.loadWodalProgramImage(
    createMicroBitV2ProgramImage(createLinkedBrainProgram(programA, [programA.entryFuncId]))
  );
  runtime.tick(16);
  const litA = runtime.snapshot().display;
  assert.equal(litA.pixels[2 * litA.width + 1], 255);

  // Reflash a different program: the prior pixel must clear, not accumulate.
  const programB = compileDisplayActuator(environment, { brightness: 255, x: 3, y: 4 });
  runtime.loadWodalProgramImage(
    createMicroBitV2ProgramImage(createLinkedBrainProgram(programB, [programB.entryFuncId]))
  );
  runtime.tick(32);
  const after = runtime.snapshot().display;
  assert.equal(after.pixels[4 * after.width + 3], 255);
  assert.equal(after.pixels[2 * after.width + 1], 0);
});

test("WodalMicroBitRuntime loads linked brain program images through core BrainRuntime", () => {
  const environment = createMicroBitV2Environment();
  const runtime = new WodalMicroBitRuntime({ environment });
  const linkedBrain = createLinkedBrainProgram();

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });
  const result = runtime.tick(25);

  assert.equal(result, undefined);
  assert.equal(runtime.snapshot().time, 25);
});

test("WodalMicroBitRuntime loads linked brain program images through the embedded profile id", () => {
  const environment = createMicroBitV2Environment();
  const runtime = new WodalMicroBitRuntime({ environment });
  const linkedBrain = createLinkedBrainProgram();

  assert.deepEqual(createMicroBitV2ProgramImage(linkedBrain), {
    format: WENDOO_PROGRAM_IMAGE_FORMAT,
    version: WENDOO_PROGRAM_IMAGE_VERSION,
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    program: linkedBrain,
  });
  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });
  const result = runtime.tick(25);

  assert.equal(result, undefined);
  assert.equal(runtime.snapshot().time, 25);
});

test("linked brain root rules route display calls through WODAL MicroBitDisplay", () => {
  const environment = createMicroBitV2Environment();
  const program = compileDisplayActuator(environment, { brightness: 77, x: 3, y: 1 });
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createLinkedBrainProgram(program, [program.entryFuncId]);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });
  const result = runtime.tick(16);

  assert.equal(result, undefined);
  const display = runtime.snapshot().display;
  assert.equal(runtime.snapshot().time, 16);
  assert.equal(display.pixels[1 * display.width + 3], 77);
});

test("test-only bundled brain runs WHEN button A pressed DO display actuator", () => {
  const environment = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createTestOnlyButtonDisplayBrain(environment);

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 0);

  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);

  assert.equal(runtime.snapshot().display.pixels[0], 201);
});

test("WodalMicroBitRuntime replaces active linked brain images", () => {
  const environment = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const firstBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 31, x: 0, y: 0 });
  const secondBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 202, x: 1, y: 0 });

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(firstBrain)), { ok: true });
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 31);

  // Reflashing resets the device: the prior program's lit pixel clears before the new program runs.
  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(secondBrain)), { ok: true });
  assert.equal(runtime.snapshot().display.pixels[0], 0);

  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);

  const display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 0);
  assert.equal(display.pixels[1], 202);
});

test("WodalMicroBitRuntime rejects program images for another profile without replacing the active brain", () => {
  const environment = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 61, x: 0, y: 0 });
  const otherBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 202, x: 1, y: 0 });

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 61);

  microbit.display.clear();
  const validation = runtime.loadWodalProgramImage({
    ...createMicroBitV2ProgramImage(otherBrain),
    profileId: "other-profile" as WodalDeviceProfileId,
  });
  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.errors.map((error) => error.code),
    [WodalProgramLoadValidationCode.UNSUPPORTED_DEVICE_PROFILE]
  );
  assert.equal(runtime.tick(16), undefined);
  const display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 61);
  assert.equal(display.pixels[1], 0);
});

test("WodalMicroBitRuntime rejects malformed serialized linked brain programs without replacing the active brain", () => {
  const environment = createMicroBitV2Environment();
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });
  const linkedBrain = createTestOnlyButtonDisplayBrain(environment, { brightness: 61, x: 0, y: 0 });

  assert.deepEqual(runtime.loadWodalProgramImage(createMicroBitV2ProgramImage(linkedBrain)), { ok: true });
  microbit.setButtonPressed("A", true);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 61);

  microbit.display.clear();
  const validation = runtime.loadSerializedWodalProgramImage({
    format: WENDOO_PROGRAM_IMAGE_FORMAT,
    version: WENDOO_PROGRAM_IMAGE_VERSION,
    profileId: WodalDeviceProfileId.MICROBIT_V2,
    program: {
      program: null,
      ruleIndex: [],
      pages: [],
    } as unknown as LinkedBrainProgramJson,
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.errors.map((error) => error.code),
    [WodalProgramLoadValidationCode.INVALID_SERIALIZED_PROGRAM]
  );
  assert.ok(validation.errors[0]?.cause);
  assert.equal(runtime.tick(16), undefined);
  assert.equal(runtime.snapshot().display.pixels[0], 61);
});

interface DisplayActuatorOptions {
  readonly brightness: number;
  readonly x: number;
  readonly y: number;
}

function compileDisplayActuator(environment: WendooEnvironment, options: DisplayActuatorOptions): UserAuthoredProgram {
  const result = compileUserTile(
    `
import { Actuator, type Context } from "wendoo";

export default Actuator({
  name: "set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(${options.x}, ${options.y}, ${options.brightness});
  },
});
`,
    { projectNamespace: TEST_PROJECT_NAMESPACE, ambientFiles: wodalAmbientFiles(), services: environment.brainServices }
  );

  assert.deepEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);
  return result.program;
}

function compileButtonDisplayActuator(
  environment: WendooEnvironment,
  options: DisplayActuatorOptions
): UserAuthoredProgram {
  const result = compileUserTile(
    `
import { Actuator, type Context } from "wendoo";

export default Actuator({
  name: "set-display-pixel-when-button-a-pressed",
  onExecute(ctx: Context): void {
    if (ctx.microbit.buttonA.isPressed()) {
      ctx.microbit.display.setPixelValue(${options.x}, ${options.y}, ${options.brightness});
    }
  },
});
`,
    { projectNamespace: TEST_PROJECT_NAMESPACE, ambientFiles: wodalAmbientFiles(), services: environment.brainServices }
  );

  assert.deepEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);
  return result.program;
}

function wodalAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "wendoo.core.d.ts",
      content: readText("../../../../../../external/wendoo-lang/packages/core/lib/wendoo.core.d.ts"),
    },
    { path: "wendoo.codal.d.ts", content: readText("../../../../lib/wendoo.codal.d.ts") },
    {
      path: "wendoo.microbit-v2.d.ts",
      content: readText("../../../../targets/microbit-v2/lib/wendoo.microbit-v2.d.ts"),
    },
  ];
}

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function createTestOnlyButtonDisplayBrain(
  environment: WendooEnvironment,
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

function compileTestOnlyButtonDisplayBundle(environment: WendooEnvironment, options: DisplayActuatorOptions) {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      [
        "button-a-pressed.ts",
        `
import { Sensor, type Context } from "wendoo";

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
import { Actuator, type Context } from "wendoo";

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
