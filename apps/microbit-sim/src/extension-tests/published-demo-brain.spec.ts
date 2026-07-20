import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createIdbProjectStore, type ProjectFileSnapshot, ProjectManager } from "@mindcraft-lang/app-host";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { AppEnvironmentHost, resolveProjectExtensions } from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { BrainDef, coreModule } from "@mindcraft-lang/core/app";
import type { IBrainDef, IBrainRuleDef, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { createWorkspaceCompiler, type WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { createWodalSharedModule, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import {
  CODAL_LIB_COORDINATE,
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
} from "../services/microbit-extension-coordinates";
import { buildMicrobitSimExportDocument } from "../services/project-io";

// The app-host reads localStorage/sessionStorage for app-side caches; provide an in-memory shim
// alongside fake-indexeddb so the host runs headlessly.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  } as Storage;
}
const globalShim = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage };
globalShim.localStorage ??= memoryStorage();
globalShim.sessionStorage ??= memoryStorage();

/** Absolute path of the built `mindcraft` CLI bin. */
const CLI_BIN = fileURLToPath(
  new URL("../../../../external/mindcraft-lang/packages/cli/dist/main.js", import.meta.url)
);

/**
 * Environment for every git and CLI invocation: user and system git
 * configuration is disabled and a fixed commit identity is provided, so runs
 * do not depend on or touch the developer's git setup.
 */
const GIT_TEST_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Mindcraft Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Mindcraft Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function runGit(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: GIT_TEST_ENV }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function runCli(cwd: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [CLI_BIN, ...args], { cwd, env: GIT_TEST_ENV }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
      } else {
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      }
    });
  });
}

function layerDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/** The three platform layers, assembled from their own `mindcraft.json` files lists. */
function layerEmbeds(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(
      layerDir("../../../../packages/wodal/targets/microbit-v2/lib"),
      MICROBIT_V2_LIB_COORDINATE
    ),
    buildEmbeddedExtensionFromDir(layerDir("../../../../packages/wodal/lib"), CODAL_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(
      layerDir("../../../../external/mindcraft-lang/packages/core/lib"),
      CORE_LIB_COORDINATE
    ),
  ];
}

/** Coordinate the demo project is published and mounted under. */
const DEMO_COORDINATE = "demo-org/demo-bot";

const SENSOR_PATH = "tiles/demo-button-pressed.ts";
const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "demo-button-pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
`;

const ACTUATOR_PATH = "tiles/demo-set-pixel.ts";
const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "demo-set-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(0, 0, 255);
  },
});
`;

function assertCleanCompile(result: WorkspaceCompileResult | undefined): asserts result is WorkspaceCompileResult {
  assert.ok(result, "expected a compile result");
  assert.equal(
    result.projectResult.tsErrors.size,
    0,
    `Unexpected TypeScript diagnostics: ${JSON.stringify([...result.projectResult.tsErrors])}`
  );
  for (const root of result.rootResults) {
    assert.equal(root.tsErrors.size, 0, `Unexpected extension diagnostics: ${JSON.stringify([...root.tsErrors])}`);
  }
}

/** Every tile placed on a rule of the brain, `when` and `do` sides, child rules included. */
function collectRuleTiles(brainDef: IBrainDef): IBrainTileDef[] {
  const tiles: IBrainTileDef[] = [];
  const visitRule = (rule: IBrainRuleDef): void => {
    rule
      .when()
      .tiles()
      .forEach((tile) => {
        tiles.push(tile);
      });
    rule
      .do()
      .tiles()
      .forEach((tile) => {
        tiles.push(tile);
      });
    const children = rule.children();
    for (let i = 0; i < children.size(); i++) {
      visitRule(children.get(i)!);
    }
  };
  const pages = brainDef.pages();
  for (let i = 0; i < pages.size(); i++) {
    const rules = pages.get(i)!.children();
    for (let j = 0; j < rules.size(); j++) {
      visitRule(rules.get(j)!);
    }
  }
  return tiles;
}

const scratchDirs: string[] = [];

after(async () => {
  for (const dir of scratchDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("published extension demo brain", () => {
  it(
    "survives export, unpack, publish, and mounting under the coordinate namespace",
    { skip: existsSync(CLI_BIN) ? false : "mindcraft CLI bin not built in this checkout" },
    async () => {
      // -- Author: a project whose own tiles a demo brain uses, in a real app host --
      const projectManager = new ProjectManager(await createIdbProjectStore("published-demo-brain"));
      const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
      let lastCompile: WorkspaceCompileResult | undefined;
      const host = new AppEnvironmentHost({
        projectManager,
        modules: [coreModule(), createWodalSharedModule(), profile.createMindcraftModule()],
        mounts: [],
        embeddedExtensions: layerEmbeds(),
        onDidCompile: (result) => {
          lastCompile = result;
        },
      });
      await host.initialize("bootstrap");

      const snapshot: ProjectFileSnapshot = new Map([
        [SENSOR_PATH, { kind: "file", content: SENSOR_SOURCE, etag: "e1", isReadonly: false }],
        [ACTUATOR_PATH, { kind: "file", content: ACTUATOR_SOURCE, etag: "e2", isReadonly: false }],
      ]);
      const created = await projectManager.createFromSnapshot(
        "Demo Bot",
        "A demo robot extension",
        snapshot,
        {},
        undefined,
        { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
        "0.1.0"
      );
      await host.switchProject(created.id);
      assertCleanCompile(lastCompile);
      const bundle = lastCompile.bundle;
      assert.ok(bundle, "expected a compiled action bundle");

      const sensorTile = bundle.tiles.find((tile) => tile.kind === "sensor");
      const actuatorTile = bundle.tiles.find((tile) => tile.kind === "actuator");
      assert.ok(sensorTile, "expected the project's sensor tile in the bundle");
      assert.ok(actuatorTile, "expected the project's actuator tile in the bundle");

      const brain = host.env.withServices((services) => BrainDef.emptyBrainDef(services, "Demo Brain"));
      const rule = brain.pages().get(0)!.children().get(0)!;
      rule.when().appendTile(sensorTile);
      rule.do().appendTile(actuatorTile);
      const brainId = brain.id();
      await host.saveBrainForKey(brainId, brain);

      const documentText = await buildMicrobitSimExportDocument(projectManager, {
        brainOrder: [brainId],
        simulator: undefined,
      });
      host.dispose();

      // -- Graduate: unpack the export and publish it to a local bare remote --
      const root = await mkdtemp(path.join(tmpdir(), "mindcraft-demo-brain-"));
      scratchDirs.push(root);
      await writeFile(path.join(root, "demo-bot.mindcraft"), documentText, "utf8");
      const remote = path.join(root, `${DEMO_COORDINATE}.git`);
      await mkdir(remote, { recursive: true });
      await runGit(root, "-c", "init.defaultBranch=main", "init", "--quiet", "--bare", remote);

      const project = path.join(root, "project");
      const unpacked = await runCli(root, "unpack", "demo-bot.mindcraft", project, "--coordinate", DEMO_COORDINATE);
      assert.equal(unpacked.code, 0, unpacked.stderr);

      // The export's embedded: layer reference publishes as-is, with no
      // confirmation flag.
      const published = await runCli(root, "publish", "--dir", project, "--remote", remote);
      assert.equal(published.code, 0, published.stderr);
      assert.match(published.stdout, /published 0\.1\.0 \(tag v0\.1\.0\)/);

      const clone = path.join(root, "clone");
      await runGit(root, "clone", "--quiet", "--branch", "v0.1.0", remote, clone);

      // -- Mount: resolve the published clone as an extension through the real resolver --
      const resolved = resolveProjectExtensions(
        { [DEMO_COORDINATE]: `embedded:${DEMO_COORDINATE}` },
        { embedded: [buildEmbeddedExtensionFromDir(clone, DEMO_COORDINATE), ...layerEmbeds()] }
      );
      // The published extension is the project's listed dependency; the layers
      // its target edges recurse to join the importable set alongside it.
      assert.deepEqual(
        resolved.dependencies.map((dependency) => dependency.coordinate).sort(),
        [DEMO_COORDINATE, CODAL_LIB_COORDINATE, CORE_LIB_COORDINATE].sort()
      );

      const env = createMicroBitV2Environment();
      const compiler = createWorkspaceCompiler({
        projectNamespace: "demo-consumer-project",
        mounts: [],
        environment: env,
        dependencies: resolved.dependencies,
        dependencyMounts: resolved.dependencyMounts,
      });
      compiler.replaceWorkspace(new Map());
      const consumerCompile = compiler.compile();
      assertCleanCompile(consumerCompile);
      assert.ok(consumerCompile.bundle, "expected the mounted extension's action bundle");
      env.replaceActionBundle(consumerCompile.bundle);

      // -- Load: the demo brain from the published manifest, under the coordinate namespace --
      const publishedManifest = JSON.parse(await readFile(path.join(clone, "mindcraft.json"), "utf8")) as {
        brains: Record<string, unknown>;
      };
      const persistedBrain = publishedManifest.brains[brainId];
      assert.ok(persistedBrain, "expected the demo brain in the published manifest");

      const loaded = env.deserializeBrainJsonFromPlain(persistedBrain, DEMO_COORDINATE);
      const tiles = collectRuleTiles(loaded);
      assert.equal(tiles.length, 2);
      assert.deepEqual(
        tiles.filter((tile) => tile.kind === "missing"),
        [],
        "every self-reference must resolve against the mounted extension's catalog"
      );
      for (const tile of tiles) {
        assert.ok(
          tile.tileId.includes(`${DEMO_COORDINATE}:`),
          `tile "${tile.tileId}" should resolve under the coordinate namespace`
        );
      }
      assert.deepEqual(
        tiles.map((tile) => tile.kind),
        ["sensor", "actuator"]
      );
    }
  );
});
