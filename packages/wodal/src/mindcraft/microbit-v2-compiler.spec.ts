import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  coreModule,
  createMindcraftEnvironment,
  type ExecutionContext,
  List,
  type MindcraftEnvironment,
} from "@mindcraft-lang/core/app";
import {
  HandleTable,
  NIL_VALUE,
  type PlatformServices,
  type Scheduler,
  type Value,
  VM,
  VmStatus,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";
import { type AmbientFile, compileUserTile, type UserAuthoredProgram } from "@mindcraft-lang/ts-compiler";
import { MicroBit } from "../microbit-v2";
import { createMicroBitV2Module } from "./microbit-v2-module";

test("compiled Mindcraft code routes display calls through WODAL MicroBitDisplay", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const program = compileDisplayActuator(environment);
  const microbit = new MicroBit();

  runProgramEntry(environment, program, microbit);

  const display = microbit.snapshot().display;
  assert.equal(display.pixels[2 * display.width + 1], 255);
});

function compileDisplayActuator(environment: MindcraftEnvironment): UserAuthoredProgram {
  const result = compileUserTile(
    `
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(1, 2, 255);
  },
});
`,
    { ambientFiles: wodalAmbientFiles(), services: environment.brainServices }
  );

  assert.deepEqual(result.diagnostics, [], `Unexpected diagnostics: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.program);
  return result.program;
}

function runProgramEntry(environment: MindcraftEnvironment, program: UserAuthoredProgram, microbit: MicroBit): void {
  const services = createVmServices(environment);
  const vm = new VM(program, services, { handles: new HandleTable(100) });
  const fiber = vm.spawnFiber(1, program.entryFuncId, List.empty<Value>(), createExecutionContext(services, microbit));
  fiber.instrBudget = 1000;

  const result = vm.runFiber(fiber, createScheduler());
  assert.equal(result.status, VmStatus.DONE);
}

function createVmServices(environment: MindcraftEnvironment): PlatformServices {
  const { runtime, shared, app } = environment.brainServices;
  return __test__createPlatformServices({ runtime, shared, app });
}

function createExecutionContext(services: PlatformServices, microbit: MicroBit): ExecutionContext {
  return {
    services,
    getVariableBySlot: () => NIL_VALUE,
    setVariableBySlot: () => {},
    data: { microbit },
    time: 0,
    dt: 0,
    currentTick: 0,
  };
}

function createScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
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
