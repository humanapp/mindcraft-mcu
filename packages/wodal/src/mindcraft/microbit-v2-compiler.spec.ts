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
  const program = compileDisplayActuator(environment);
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  runtime.loadProgram(program);
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
