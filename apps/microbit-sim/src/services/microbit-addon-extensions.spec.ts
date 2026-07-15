import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import {
  buildExtensionCatalog,
  collectMetadataFromCompile,
  findEmbeddedExtensionsMissingStableIds,
  formatEmbeddedExtensionIdViolations,
  resolveProjectExtensions,
} from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { buildMicrobitExtensionEntries, MICROBIT_LAYER_COORDINATES } from "./microbit-extension-browser";
import {
  CODAL_LIB_COORDINATE,
  CODAL_POSITION_EXT_COORDINATE,
  CODAL_POSITION_EXT_REFERENCE,
  CORE_LIB_COORDINATE,
  CUTEBOT_EXT_COORDINATE,
  CUTEBOT_EXT_REFERENCE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  YAHBOOM_GAMEPAD_EXT_COORDINATE,
  YAHBOOM_GAMEPAD_EXT_REFERENCE,
} from "./microbit-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/** The Position add-on assembled from its own `mindcraft.json` `files` list through the shared loader. */
function codalPositionAddon(): EmbeddedExtension {
  return buildEmbeddedExtensionFromDir(
    extensionDir("../../extensions/codal-position-ext"),
    CODAL_POSITION_EXT_COORDINATE
  );
}

/** The Cutebot chassis add-on assembled from its own `mindcraft.json` `files` list through the shared loader. */
function cutebotAddon(): EmbeddedExtension {
  return buildEmbeddedExtensionFromDir(extensionDir("../../extensions/microbit-cutebot-ext"), CUTEBOT_EXT_COORDINATE);
}

/** The Yahboom gamepad add-on assembled from its own `mindcraft.json` `files` list through the shared loader. */
function gamepadAddon(): EmbeddedExtension {
  return buildEmbeddedExtensionFromDir(
    extensionDir("../../extensions/microbit-yahboom-gamepad-ext"),
    YAHBOOM_GAMEPAD_EXT_COORDINATE
  );
}

/**
 * The three microbit layer libraries assembled from each extension's own
 * `mindcraft.json` `files` list through the shared loader. The layer stack is
 * core <- wodal <- microbit-v2.
 */
function microbitLayers(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../packages/wodal/targets/microbit-v2/lib"),
      MICROBIT_V2_LIB_COORDINATE
    ),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/wodal/lib"), CODAL_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../external/mindcraft-lang/packages/core/lib"),
      CORE_LIB_COORDINATE
    ),
  ];
}

/** The microbit app's embed record: the three layers plus the Position, Cutebot, and Yahboom gamepad add-ons. */
function microbitEmbedRecord(): EmbeddedExtension[] {
  return [...microbitLayers(), codalPositionAddon(), cutebotAddon(), gamepadAddon()];
}

const microbitProject = { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE };

describe("microbit add-on extensions -- every declaration ships a stable id", () => {
  test("no bundled add-on declares a Sensor, Actuator, or Conversion without an explicit stable id", () => {
    const services = createMicroBitV2Environment().brainServices;
    const violations = findEmbeddedExtensionsMissingStableIds(microbitEmbedRecord(), services);
    assert.deepEqual(violations, [], formatEmbeddedExtensionIdViolations(violations));
  });
});

describe("microbit add-on extensions -- the gamepad add-on depends on the Position add-on across layers", () => {
  test("installing the gamepad pulls the Position add-on into the resolved closure and its tiles reference Position", () => {
    const extensions: Record<string, string> = {
      [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
      [YAHBOOM_GAMEPAD_EXT_COORDINATE]: YAHBOOM_GAMEPAD_EXT_REFERENCE,
    };
    const resolved = resolveProjectExtensions(extensions, { embedded: microbitEmbedRecord() });

    // The gamepad's manifest edge to the Position add-on resolves transitively,
    // even though Position targets the lower wodal layer and the gamepad targets
    // micro:bit v2 -- the first cross-layer add-on -> add-on dependency.
    const origins = resolved.dependencyMounts.map((m) => m.namespace);
    assert.ok(origins.includes(YAHBOOM_GAMEPAD_EXT_COORDINATE), "the gamepad is in the closure");
    assert.ok(origins.includes(CODAL_POSITION_EXT_COORDINATE), "the Position add-on is pulled in as the gamepad's dep");
    const gamepadMount = resolved.dependencyMounts.find((m) => m.namespace === YAHBOOM_GAMEPAD_EXT_COORDINATE)!;
    assert.deepEqual(gamepadMount.dependencies, [{ coordinate: CODAL_POSITION_EXT_COORDINATE }]);

    const environment = createMicroBitV2Environment();
    const mounts: readonly Mount[] = [];
    const compiler = createWorkspaceCompiler({
      projectNamespace: "microbit-gamepad-probe",
      mounts,
      environment,
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
    });
    compiler.replaceWorkspace(new Map());
    const result = compiler.compile();

    for (const root of result.rootResults) {
      assert.equal(root.tsErrors.size, 0, `gamepad closure must compile clean: ${JSON.stringify([...root.tsErrors])}`);
    }

    // The gamepad's Position-typed inline sensor lowers into the bundle, and the
    // Position struct's accessor and variable tiles register under the Position
    // add-on's own namespace -- proof the `@ext` struct-type reference resolves
    // across the add-on boundary at runtime.
    const tiles = collectMetadataFromCompile(result);
    const stickPosition = tiles.find((t) => t.name === "stick position");
    assert.ok(stickPosition, "the gamepad's Position-returning sensor is registered");
    assert.equal(stickPosition.namespace, YAHBOOM_GAMEPAD_EXT_COORDINATE);
    assert.ok(result.bundle, "a compiled bundle is produced");
    assert.ok(
      result.bundle.actions.get(stickPosition.key),
      "the Position-returning sensor's action is lowered into the bundle"
    );

    for (const rootResult of result.rootResults) {
      for (const [, compileResult] of rootResult.results) {
        for (const diag of compileResult.diagnostics) {
          assert.notEqual(diag.code, 5014, "no duplicate-stable-id diagnostic is raised across the closure");
        }
      }
    }
  });
});

describe("microbit add-on extensions -- browser catalog compatibility", () => {
  test("a microbit project lists the wodal-targeted Position add-on as an installable, unlocked entry", () => {
    const entries = buildMicrobitExtensionEntries(microbitProject, microbitEmbedRecord());

    const position = entries.find((e) => e.coordinate === CODAL_POSITION_EXT_COORDINATE);
    assert.ok(position, "Position is in the microbit project catalog even though it targets the lower wodal layer");
    assert.equal(position.locked, false, "an add-on is not a locked layer library");
    assert.equal(position.installed, false, "an add-on is not installed by default");
    assert.equal(position.name, "Position");
  });

  test("a sim-shaped project's catalog excludes the wodal-targeted Position add-on", () => {
    const SIM_COORDINATE = "mindcraft-lang/sim";
    const simLayer: EmbeddedExtension = {
      canonicalOrigin: SIM_COORDINATE,
      files: [
        {
          path: "mindcraft.json",
          content: JSON.stringify({
            name: "Sim",
            version: "0.1.0",
            extensions: { [CORE_LIB_COORDINATE]: `embedded:${CORE_LIB_COORDINATE}` },
          }),
        },
      ],
    };
    const coreLayer = microbitLayers().find((layer) => layer.canonicalOrigin === CORE_LIB_COORDINATE)!;
    const embedRecord = [simLayer, coreLayer, codalPositionAddon()];
    const simLayerCoordinates = new Set([CORE_LIB_COORDINATE, SIM_COORDINATE]);

    const catalog = buildExtensionCatalog(
      { [SIM_COORDINATE]: `embedded:${SIM_COORDINATE}` },
      embedRecord,
      simLayerCoordinates
    );
    const coordinates = catalog.map((e) => e.coordinate);
    assert.equal(
      coordinates.includes(CODAL_POSITION_EXT_COORDINATE),
      false,
      "Position is hidden off a stack that lacks the wodal layer"
    );
  });

  test("the locked layer coordinates cover the three platform layers only", () => {
    assert.equal(MICROBIT_LAYER_COORDINATES.has(CODAL_POSITION_EXT_COORDINATE), false);
    assert.equal(MICROBIT_LAYER_COORDINATES.has(MICROBIT_V2_LIB_COORDINATE), true);
  });
});

describe("microbit add-on extensions -- install materializes a usable type", () => {
  const HOST_PROGRAM = `import { Sensor, type Context } from "mindcraft";
import { Position } from "@ext/mindcraft-lang/codal-position-ext";

export default Sensor({
  name: "position probe",
  returnType: Position,
  inline: true,
  onExecute(ctx: Context): Position {
    return Position({ x: 0, y: 0 });
  },
});
`;

  test("installing Position lets a host program reference its published struct type across the @ext boundary", () => {
    const extensions: Record<string, string> = {
      [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
      [CODAL_POSITION_EXT_COORDINATE]: CODAL_POSITION_EXT_REFERENCE,
    };
    const resolved = resolveProjectExtensions(extensions, { embedded: microbitEmbedRecord() });
    const environment = createMicroBitV2Environment();
    const mounts: readonly Mount[] = [];
    const compiler = createWorkspaceCompiler({
      projectNamespace: "microbit-addon-probe",
      mounts,
      environment,
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
    });
    const snapshot: WorkspaceSnapshot = new Map([
      ["main.ts", { kind: "file", content: HOST_PROGRAM, etag: "e0", isReadonly: false }],
    ]);
    compiler.replaceWorkspace(snapshot);
    const result = compiler.compile();

    assert.equal(
      result.projectResult.tsErrors.size,
      0,
      `the host program references Position across @ext and must compile clean: ${JSON.stringify([
        ...result.projectResult.tsErrors,
      ])}`
    );

    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(`.extensions/${CODAL_POSITION_EXT_COORDINATE}/index.ts`),
      "the Position extension entry materializes under .extensions/"
    );

    // The host sensor lowers, and no duplicate-stable-id diagnostic (5014) is raised.
    const tiles = collectMetadataFromCompile(result);
    assert.ok(
      tiles.some((t) => t.name === "position probe"),
      "the host sensor that returns Position is registered"
    );
    for (const rootResult of result.rootResults) {
      for (const [, compileResult] of rootResult.results) {
        for (const diag of compileResult.diagnostics) {
          assert.notEqual(diag.code, 5014, "no duplicate-stable-id diagnostic is raised");
        }
      }
    }
  });
});
