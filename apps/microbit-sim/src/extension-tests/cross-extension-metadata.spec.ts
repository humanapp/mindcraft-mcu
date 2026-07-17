/**
 * Live-path coverage for cross-extension user-tile registration when two
 * installed extensions share a third extension's struct type across the `@lib`
 * boundary: the Yahboom gamepad's `decoded stick position` (returnType
 * `Position`) and the Cutebot's `cutebot steer` (a `Position` param) both
 * reference the Position add-on's type. It resolves the gamepad + Cutebot
 * coordinates through the real embed record and transitive resolver, compiles
 * them, and drives the same bridge-app registration entry points the app uses --
 * `collectMetadataFromCompile` and `applyCompiledUserTiles` -- to pin that the
 * collected metadata is JSON-serializable and that applying the compiled bundle
 * registers both cross-extension tiles.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import {
  applyCompiledUserTiles,
  collectMetadataFromCompile,
  resolveProjectExtensions,
} from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  createWorkspaceCompiler,
  type WorkspaceCompileResult,
  type WorkspaceSnapshot,
} from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import {
  CODAL_LIB_COORDINATE,
  CODAL_POSITION_EXT_COORDINATE,
  CORE_LIB_COORDINATE,
  CUTEBOT_EXT_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  YAHBOOM_GAMEPAD_EXT_COORDINATE,
} from "../services/microbit-extension-coordinates.js";

const DECODED_LABEL = "decoded stick position";
const STEER_LABEL = "cutebot steer";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/** The microbit-sim embed record: the three platform layers plus the Position, Cutebot, and gamepad add-ons. */
function embedRecord(): EmbeddedExtension[] {
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
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-codal-position"), CODAL_POSITION_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-microbit-cutebot"), CUTEBOT_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../extensions/lib-microbit-yahboom-gamepad"),
      YAHBOOM_GAMEPAD_EXT_COORDINATE
    ),
  ];
}

/** Compile the gamepad + Cutebot add-ons into a fresh micro:bit v2 environment via the real transitive resolver. */
function compileGamepadAndCutebot(env: MindcraftEnvironment): WorkspaceCompileResult {
  const extensions: Record<string, string> = {
    [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
    [YAHBOOM_GAMEPAD_EXT_COORDINATE]: `embedded:${YAHBOOM_GAMEPAD_EXT_COORDINATE}`,
    [CUTEBOT_EXT_COORDINATE]: `embedded:${CUTEBOT_EXT_COORDINATE}`,
  };
  const resolved = resolveProjectExtensions(extensions, { embedded: embedRecord() });
  const compiler = createWorkspaceCompiler({
    projectNamespace: "cross-extension-metadata",
    mounts: [],
    environment: env,
    dependencies: resolved.dependencies,
    dependencyMounts: resolved.dependencyMounts,
  });
  compiler.replaceWorkspace(new Map() as WorkspaceSnapshot);
  const result = compiler.compile();
  assert.equal(
    result.projectResult.tsErrors.size,
    0,
    `project TS errors: ${JSON.stringify([...result.projectResult.tsErrors])}`
  );
  for (const root of result.rootResults) {
    assert.equal(root.tsErrors.size, 0, `extension TS errors: ${JSON.stringify([...root.tsErrors])}`);
  }
  return result;
}

/** Whether a tile with the given display label is registered in the environment. */
function envHasTile(env: MindcraftEnvironment, label: string): boolean {
  for (const catalog of env.tileCatalogs()) {
    for (const tile of catalog.getAll().toArray()) {
      if (tile.metadata?.label === label) {
        return true;
      }
    }
  }
  return false;
}

describe("cross-extension user-tile metadata", () => {
  let env: MindcraftEnvironment;
  let result: WorkspaceCompileResult;

  before(() => {
    env = createMicroBitV2Environment();
    result = compileGamepadAndCutebot(env);
  });

  test("the collected metadata for Position-typed cross-extension tiles is JSON-serializable", () => {
    const metadata = collectMetadataFromCompile(result);
    assert.ok(
      metadata.some((m) => m.name === DECODED_LABEL),
      "the gamepad's decoded stick position tile is collected"
    );
    assert.ok(
      metadata.some((m) => m.name === STEER_LABEL),
      "the Cutebot's steer tile is collected"
    );
    assert.doesNotThrow(() => JSON.stringify(metadata), "the metadata carries no live AST node");
  });

  test("applying the compiled bundle registers both cross-extension tiles", () => {
    const applyResult = applyCompiledUserTiles(env, result);
    assert.ok(applyResult, "applying produced a result");
    assert.ok(envHasTile(env, DECODED_LABEL), "decoded stick position registered in the environment");
    assert.ok(envHasTile(env, STEER_LABEL), "cutebot steer registered in the environment");
  });
});
