import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { CompiledActionBundle } from "@mindcraft-lang/core";
import { BrainDef, type IBrainDef } from "@mindcraft-lang/core/app";
import { linkedBrainProgramToJson } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { UserCodeReflasher } from "./user-code-reflasher";

type MicroBitV2Environment = ReturnType<typeof createMicroBitV2Environment>;

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** The microbit-v2 compiler surface, read from disk (the app's `?raw` imports are Vite-only). */
function microbitAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    {
      path: "mindcraft.codal.d.ts",
      content: readText("../../../../packages/wodal/ambient/mindcraft.codal.d.ts"),
    },
    {
      path: "mindcraft.microbit-v2.d.ts",
      content: readText("../../../../packages/wodal/ambient/mindcraft.microbit-v2.d.ts"),
    },
  ];
}

// Pinned action ids; each action's key stays stable across recompiles while a body edit changes its bytecode.
const SENSOR_ID = "senButtonPressed0";
const ACTUATOR_ID = "actDisplayPixel00";

const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "${SENSOR_ID}",
  name: "button-a-pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
`;

/** An actuator that lights one pixel to `brightness`. */
function actuatorSource(brightness: number): string {
  return `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  id: "${ACTUATOR_ID}",
  name: "set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(0, 0, ${brightness});
  },
});
`;
}

function compileBundle(environment: MicroBitV2Environment, files: Map<string, string>): CompiledActionBundle {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: microbitAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(files);
  const compileResult = project.compileAll();
  assert.equal(
    compileResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
  );
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle, "expected a compiled action bundle");
  return bundle;
}

/** A JSON-comparable snapshot of the program a fresh link of `brainDef` currently produces. */
function linkedProgramJson(environment: MicroBitV2Environment, brainDef: IBrainDef): string {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const built = buildWodalProgramImage({ brainDef, environment, deviceProfile: profile });
  if (!built.ok) {
    assert.fail(`build failed: ${JSON.stringify(built.errors)}`);
  }
  return JSON.stringify(linkedBrainProgramToJson(built.image.program));
}

/** A brain whose single rule runs `actuatorTile`, with nothing on its `when` side. */
function brainUsingActuator(environment: MicroBitV2Environment, bundle: CompiledActionBundle): IBrainDef {
  const actuatorTile = bundle.tiles.find((tile) => tile.kind === "actuator");
  assert.ok(actuatorTile, "expected an actuator tile in the bundle");
  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "uses the actuator");
  brainDef.pages().get(0)!.children().get(0)!.do().appendTile(actuatorTile);
  return brainDef;
}

describe("user-code edits reflash flashed instances", () => {
  it("reflashes a flashed brain with the new program when an action it uses changes", () => {
    const environment = createMicroBitV2Environment();
    const bundleV1 = compileBundle(
      environment,
      new Map([
        ["button-a-pressed.ts", SENSOR_SOURCE],
        ["set-display-pixel.ts", actuatorSource(255)],
      ])
    );
    environment.replaceActionBundle(bundleV1);

    const brainDef = brainUsingActuator(environment, bundleV1);
    const brainId = brainDef.id();
    const programBeforeEdit = linkedProgramJson(environment, brainDef);

    const reflashCalls: string[] = [];
    const reflashedPrograms: string[] = [];
    const reflasher = new UserCodeReflasher({
      flashedBrainIds: () => [brainId],
      getBrainDef: (id) => (id === brainId ? brainDef : undefined),
      reflashBrain: (id) => {
        reflashCalls.push(id);
        reflashedPrograms.push(linkedProgramJson(environment, brainDef));
      },
    });

    const update = environment.replaceActionBundle(
      compileBundle(
        environment,
        new Map([
          ["button-a-pressed.ts", SENSOR_SOURCE],
          ["set-display-pixel.ts", actuatorSource(64)],
        ])
      )
    );
    assert.ok(update.changedActionKeys.length > 0, "editing the actuator should change its action key");

    reflasher.onActionsChanged(update.changedActionKeys);
    reflasher.flush();

    assert.deepEqual(reflashCalls, [brainId]);
    assert.notEqual(reflashedPrograms[0], programBeforeEdit, "the reflashed program should reflect the edited code");
  });

  it("does not reflash a flashed brain that references no user-code action", () => {
    const environment = createMicroBitV2Environment();
    const bundleV1 = compileBundle(environment, new Map([["set-display-pixel.ts", actuatorSource(255)]]));
    environment.replaceActionBundle(bundleV1);

    // A brain that references no user-code action.
    const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "uses no user code");
    const brainId = brainDef.id();

    const reflashCalls: string[] = [];
    const reflasher = new UserCodeReflasher({
      flashedBrainIds: () => [brainId],
      getBrainDef: (id) => (id === brainId ? brainDef : undefined),
      reflashBrain: (id) => {
        reflashCalls.push(id);
      },
    });

    reflasher.onActionsChanged(recompileActuator(environment, actuatorSource(64)));
    reflasher.flush();

    assert.deepEqual(reflashCalls, [], "a brain with no user tiles must not be reflashed by a user-code edit");
  });

  it("coalesces rapid recompiles into a single reflash per affected brain", () => {
    const environment = createMicroBitV2Environment();
    const bundleV1 = compileBundle(environment, new Map([["set-display-pixel.ts", actuatorSource(255)]]));
    environment.replaceActionBundle(bundleV1);

    const brainDef = brainUsingActuator(environment, bundleV1);
    const brainId = brainDef.id();
    const actuatorKey = recompileActuator(environment, actuatorSource(64));

    const reflashCalls: string[] = [];
    const reflasher = new UserCodeReflasher({
      flashedBrainIds: () => [brainId],
      getBrainDef: (id) => (id === brainId ? brainDef : undefined),
      reflashBrain: (id) => {
        reflashCalls.push(id);
      },
    });

    reflasher.onActionsChanged(actuatorKey);
    reflasher.onActionsChanged(actuatorKey);
    reflasher.flush();

    assert.deepEqual(reflashCalls, [brainId], "a burst of recompiles should reflash the brain once");
  });

  it("reflashes after the debounce window elapses without an explicit flush", async () => {
    const environment = createMicroBitV2Environment();
    const bundleV1 = compileBundle(environment, new Map([["set-display-pixel.ts", actuatorSource(255)]]));
    environment.replaceActionBundle(bundleV1);

    const brainDef = brainUsingActuator(environment, bundleV1);
    const brainId = brainDef.id();
    const actuatorKey = recompileActuator(environment, actuatorSource(64));

    const reflashCalls: string[] = [];
    const reflasher = new UserCodeReflasher(
      {
        flashedBrainIds: () => [brainId],
        getBrainDef: (id) => (id === brainId ? brainDef : undefined),
        reflashBrain: (id) => {
          reflashCalls.push(id);
        },
      },
      0
    );

    reflasher.onActionsChanged(actuatorKey);
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(reflashCalls, [brainId]);
  });
});

/** Recompiles the actuator with `actuatorSource(...)`, applies it to `environment`, and returns the changed keys. */
function recompileActuator(environment: MicroBitV2Environment, actuator: string): readonly string[] {
  const result = environment.replaceActionBundle(
    compileBundle(environment, new Map([["set-display-pixel.ts", actuator]]))
  );
  assert.ok(result.changedActionKeys.length > 0, "expected the recompile to change the actuator");
  return result.changedActionKeys;
}
