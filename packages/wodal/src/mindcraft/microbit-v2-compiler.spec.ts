import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { VmStatus } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, compileUserTile, type UserAuthoredProgram } from "@mindcraft-lang/ts-compiler";
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
  const result = runtime.runOnce();

  assert.equal(result.status, VmStatus.DONE);
  const display = runtime.snapshot().display;
  assert.equal(display.pixels[2 * display.width + 1], 255);
});

test("WodalMicroBitRuntime reports missing loaded program with a stable code", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const runtime = new WodalMicroBitRuntime({ environment });

  assert.throws(
    () => runtime.runOnce(),
    (error) => error instanceof WodalError && error.code === MISSING_WODAL_PROGRAM
  );
});

test("WodalMicroBitRuntime keeps the active program when image validation fails", () => {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
  const runtime = new WodalMicroBitRuntime({ environment });
  const firstProgram = compileDisplayActuator(environment, { brightness: 111, x: 0, y: 0 });
  const secondProgram = compileDisplayActuator(environment, { brightness: 222, x: 4, y: 4 });

  assert.deepEqual(runtime.loadImage({ version: 1, program: firstProgram }), { ok: true, errors: [] });
  assert.equal(runtime.runOnce().status, VmStatus.DONE);

  runtime.microbit.display.clear();
  const validation = runtime.loadImage({ version: 65536, program: null });
  assert.equal(validation.ok, false);
  assert.equal(runtime.runOnce().status, VmStatus.DONE);
  assert.equal(runtime.snapshot().display.pixels[0], 111);

  runtime.microbit.display.clear();
  assert.deepEqual(runtime.loadImage({ version: 1, program: secondProgram }), { ok: true, errors: [] });
  assert.equal(runtime.runOnce().status, VmStatus.DONE);
  const display = runtime.snapshot().display;
  assert.equal(display.pixels[0], 0);
  assert.equal(display.pixels[4 * display.width + 4], 222);
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
