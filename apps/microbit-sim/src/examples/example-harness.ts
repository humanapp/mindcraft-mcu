import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { resolveEmbeddedExtensions } from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import type { CompiledActionBundle } from "@mindcraft-lang/core";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { TypeId } from "@mindcraft-lang/core/runtime";
import {
  createWorkspaceCompiler,
  type Mount,
  qualifiedClassName,
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
} from "../services/microbit-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * Registry name the Position struct type is registered under: the Position
 * add-on's coordinate namespace, its entry module, and the `Position` binding.
 * The gamepad tiles reference it across the `@ext` boundary, but its accessor
 * and variable-factory tiles register under this declaring namespace.
 */
export const POSITION_IDENTITY = qualifiedClassName(CODAL_POSITION_EXT_COORDINATE, "/index.ts", "Position");

/** The Cutebot chassis add-on's coordinate; test-only tiles that reach the arbitrator compile into this namespace. */
export { CUTEBOT_EXT_COORDINATE, YAHBOOM_GAMEPAD_EXT_COORDINATE } from "../services/microbit-extension-coordinates";

/**
 * The microbit-sim embed record: the three platform layers plus the Position,
 * Cutebot, and Yahboom gamepad add-ons, each assembled from its own
 * `mindcraft.json` `files` list through the shared loader -- the single
 * content-assembly path the app's Vite provider also uses.
 */
function baseEmbedRecord(): EmbeddedExtension[] {
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
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/codal-position-ext"), CODAL_POSITION_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/microbit-cutebot-ext"), CUTEBOT_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../extensions/microbit-yahboom-gamepad-ext"),
      YAHBOOM_GAMEPAD_EXT_COORDINATE
    ),
  ];
}

/** An extra test-only source file compiled into an extension's namespace. */
export interface ExtensionFileOverlay {
  /** Coordinate of the extension namespace the file joins. */
  coordinate: string;
  /** Extension-relative file name. */
  path: string;
  /** Source content. */
  content: string;
}

/** Inputs describing what a spec installs and which test-only tiles it compiles. */
export interface HarnessOptions {
  /** Coordinates to install on top of the seeded micro:bit v2 layer. */
  install: readonly string[];
  /** Test-only tile sources compiled in the host workspace, keyed by file name. Ids are minted. */
  workspaceTiles?: Readonly<Record<string, string>>;
  /**
   * Test-only tile sources compiled into an installed extension's own namespace,
   * so they may import that extension's internal modules relatively. Read-only
   * extension source, so each declaration must carry an explicit stable id.
   */
  extensionTiles?: readonly ExtensionFileOverlay[];
}

/** A compiled example environment: the runtime env, the combined bundle, and tile lookups. */
export interface ExampleHarness {
  /** The micro:bit v2 runtime environment with the compiled bundle installed. */
  env: MindcraftEnvironment;
  /** The combined action bundle spanning the workspace and every installed extension. */
  bundle: CompiledActionBundle;
  /** Resolves a compiled tile by its display label. */
  userTile(name: string): IBrainTileDef;
  /** The registered TypeId of the Position struct type (requires the Position add-on installed). */
  positionTypeId(): TypeId;
}

/**
 * Compile the installed driver extensions and any test-only tiles into one
 * micro:bit v2 environment, mirroring how the app resolves and mounts embedded
 * extensions. Driver tiles come from their extension namespaces; test-only
 * scaffolding tiles are compiled either in the host workspace or, when they
 * must reach an extension's internal modules, into that extension's namespace.
 */
export function buildExampleHarness(options: HarnessOptions): ExampleHarness {
  const overlays = options.extensionTiles ?? [];
  const embedRecord: EmbeddedExtension[] = baseEmbedRecord().map((extension) => {
    const extra = overlays.filter((overlay) => overlay.coordinate === extension.canonicalOrigin);
    if (extra.length === 0) {
      return extension;
    }
    return { ...extension, files: [...extension.files, ...extra.map((o) => ({ path: o.path, content: o.content }))] };
  });

  const extensions: Record<string, string> = { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE };
  for (const coordinate of options.install) {
    extensions[coordinate] = `embedded:${coordinate}`;
  }
  const resolved = resolveEmbeddedExtensions(extensions, embedRecord);

  const env = createMicroBitV2Environment();
  const mounts: readonly Mount[] = [];
  const compiler = createWorkspaceCompiler({
    projectNamespace: "microbit-example-harness",
    mounts,
    environment: env,
    dependencies: resolved.dependencies,
    dependencyMounts: resolved.dependencyMounts,
  });

  const snapshot: WorkspaceSnapshot = new Map(
    Object.entries(options.workspaceTiles ?? {}).map(([path, content]) => [
      path,
      { kind: "file", content, etag: "e0", isReadonly: false },
    ])
  );
  compiler.replaceWorkspace(snapshot);
  const result = compiler.compile();
  assert.equal(
    result.projectResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...result.projectResult.tsErrors])}`
  );
  for (const root of result.rootResults) {
    assert.equal(root.tsErrors.size, 0, `Unexpected extension diagnostics: ${JSON.stringify([...root.tsErrors])}`);
  }
  const bundle = result.bundle;
  assert.ok(bundle, "expected a compiled action bundle");
  env.replaceActionBundle(bundle);

  const tilesByName = new Map<string, IBrainTileDef>();
  for (const tile of bundle.tiles) {
    if (tile.metadata?.label) {
      tilesByName.set(tile.metadata.label, tile);
    }
  }

  return {
    env,
    bundle,
    userTile(name: string): IBrainTileDef {
      const tile = tilesByName.get(name);
      assert.ok(tile, `user tile "${name}" not found; have: ${[...tilesByName.keys()].join(", ")}`);
      return tile;
    },
    positionTypeId(): TypeId {
      const typeId = env.brainServices.runtime.types.resolveByName(POSITION_IDENTITY);
      assert.ok(typeId, "expected the position type to be registered");
      return typeId;
    },
  };
}
