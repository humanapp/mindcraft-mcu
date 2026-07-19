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
  type LinkedBrainProgramJson,
  linkedBrainProgramToJson,
  Op,
} from "@mindcraft-lang/core/runtime";
import {
  type AmbientFile,
  buildCompiledActionBundle,
  type ProjectCompileResult,
  UserTileProject,
} from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { buildWodalProgramImage } from "../../../mindcraft/build-kernel";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import {
  parseWodalProgramImage,
  serializeWodalProgramImageJson,
  type WodalProgramImage,
} from "../../../mindcraft/program-image";
import { MicroBit } from "../microbit";
import { createMicroBitV2Environment } from "./environment";
import { WodalMicroBitRuntime } from "./runtime";
import { MicroBitV2HostFuncId } from "./tile-ids";

// A user-authored microbit-v2 program: button-A sensor in when(), set-pixel actuator in do().
// Unlike button-display.mcprogram (host actions, no bytecode), this golden exercises the VM's
// bytecode-action path: its tiles compile to bytecode the linker embeds in program.actions.
const GOLDEN_PATH = fileURLToPath(new URL("./__fixtures__/user-tile-button-display.mcprogram", import.meta.url));

const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "user-button-a-pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
`;

const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "user-set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(0, 0, 255);
  },
});
`;

function microbitEnvironment(): MindcraftEnvironment {
  return createMicroBitV2Environment();
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

/** Compiles the user tiles, installs them, and builds the button-A -> set-pixel program image. */
function buildUserTileButtonDisplayImage(environment: MindcraftEnvironment): WodalProgramImage<LinkedBrainProgram> {
  const project = new UserTileProject({
    projectNamespace: TEST_PROJECT_NAMESPACE,
    ambientFiles: wodalAmbientFiles(),
    services: environment.brainServices,
  });
  project.setFiles(
    new Map([
      ["user-button-a-pressed.ts", SENSOR_SOURCE],
      ["user-set-display-pixel.ts", ACTUATOR_SOURCE],
    ])
  );
  const compileResult = project.compileAll();
  assertProjectCompiled(compileResult);
  const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
  assert.ok(bundle);
  environment.replaceActionBundle(bundle);

  const sensorTile = findBundleTile(bundle.tiles, "sensor");
  const actuatorTile = findBundleTile(bundle.tiles, "actuator");
  const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "user-tile button display brain");
  const rule = brainDef.pages().get(0)!.children().get(0)!;
  rule.when().appendTile(sensorTile);
  rule.do().appendTile(actuatorTile);

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

function serializeBuiltImage(image: WodalProgramImage<LinkedBrainProgram>): string {
  return serializeWodalProgramImageJson({ ...image, program: linkedBrainProgramToJson(image.program) });
}

/** Loads a serialized image and asserts a button-A press lights display pixel (0,0) via bytecode. */
function assertButtonLightsPixel(
  environment: MindcraftEnvironment,
  image: WodalProgramImage<LinkedBrainProgramJson>
): void {
  const microbit = new MicroBit();
  const runtime = new WodalMicroBitRuntime({ environment, microbit });

  assert.deepEqual(runtime.loadSerializedWodalProgramImage(image), { ok: true });

  runtime.tick(16);
  assert.equal(microbit.display.getPixelValue(0, 0), 0);

  microbit.setButtonPressed("A", true);
  runtime.tick(32);
  assert.equal(microbit.display.getPixelValue(0, 0), 255);
}

test("a freshly built user-tile button-display image serializes, parses, loads, and runs", () => {
  const environment = microbitEnvironment();
  const image = buildUserTileButtonDisplayImage(environment);

  const parsed = parseWodalProgramImage(serializeBuiltImage(image));
  assert.equal(parsed.ok, true);

  assertButtonLightsPixel(environment, parsed.image as WodalProgramImage<LinkedBrainProgramJson>);
});

test("the committed user-tile golden carries bytecode actions and parses, loads, and runs", () => {
  if (!existsSync(GOLDEN_PATH)) {
    writeFileSync(GOLDEN_PATH, serializeBuiltImage(buildUserTileButtonDisplayImage(microbitEnvironment())));
  }
  const raw = readFileSync(GOLDEN_PATH, "utf8");

  // The distinguishing property vs the host-action golden (which has an empty actions table): the
  // linked program embeds user-tile bytecode actions, each recording its entry function id.
  const golden = JSON.parse(raw) as { program: { program: { actions: { entryFuncId: number }[] } } };
  const actions = golden.program.program.actions;
  assert.equal(actions.length, 2, "expected the golden to embed the sensor and actuator bytecode actions");
  for (const action of actions) {
    assert.equal(typeof action.entryFuncId, "number");
  }

  const parsed = parseWodalProgramImage(raw);
  assert.equal(parsed.ok, true);
  assertButtonLightsPixel(microbitEnvironment(), parsed.image as WodalProgramImage<LinkedBrainProgramJson>);
});

test("the committed user-tile golden is de-stringed: its string pool holds no static field names", () => {
  if (!existsSync(GOLDEN_PATH)) {
    writeFileSync(GOLDEN_PATH, serializeBuiltImage(buildUserTileButtonDisplayImage(microbitEnvironment())));
  }
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
    program: { program: { constantPools: { strings: string[] } } };
  };
  // The tiles' static field reads (ctx.microbit.buttonA, ctx.microbit.display) compile to
  // STRUCT_GET_FIELD by id; the program interns no field-name strings.
  const strings = golden.program.program.constantPools.strings;
  assert.deepEqual(
    strings,
    [],
    `expected an empty string pool after field-access de-stringing; got: ${JSON.stringify(strings)}`
  );
});

test("the committed user-tile golden's HOST_CALLs carry the declared stable funcIds", () => {
  if (!existsSync(GOLDEN_PATH)) {
    writeFileSync(GOLDEN_PATH, serializeBuiltImage(buildUserTileButtonDisplayImage(microbitEnvironment())));
  }
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
    program: { program: { functions: { code: { op: number; a?: number }[] }[] } };
  };

  const funcIds = new Set<number>();
  for (const fn of golden.program.program.functions) {
    for (const ins of fn.code) {
      if (ins.op === Op.HOST_CALL || ins.op === Op.HOST_CALL_ASYNC) {
        funcIds.add(ins.a ?? -1);
      }
    }
  }
  assert.deepEqual(
    [...funcIds].sort((a, b) => a - b),
    [CoreFuncId.OpNotEqualToNumber, MicroBitV2HostFuncId.DisplaySetPixelValue, MicroBitV2HostFuncId.ButtonIsPressed]
  );
});
