import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createIdbProjectStore, importProjectDocument, ProjectManager } from "@wendoo/app-host";
import { AppEnvironmentHost } from "@wendoo/bridge-app";
import { BrainDef, coreModule } from "@wendoo/core/app";
import { createWodalSharedModule, getWodalDeviceProfile, WodalDeviceProfileId } from "@wendoo/wodal";
import { name as appName } from "../../package.json";
import {
  BRAINS_INDEX_KEY,
  buildMicrobitSimExportDocument,
  parseMicrobitSimAppChunk,
  SIMULATOR_STATE_KEY,
  translateMicrobitSimAppChunk,
} from "./project-io";

const FIXTURE_PATH = fileURLToPath(new URL("./__fixtures__/sample-project.wendoo", import.meta.url));

/** Extension dependencies seeded into the sample project, coordinate-keyed, one per reference form. */
const FIXTURE_EXTENSIONS = {
  "example-org/wendoo-position": "gh:example-org/wendoo-position@v1.2.0",
  "example-org/steering": "gh:example-org/steering#main",
  "wendoo-lang/lib-codal": "embedded:wendoo-lang/lib-codal",
};

/** User-tile source seeded into the sample project's workspace. */
const FIXTURE_TILE_PATH = "tiles/button-a-pressed.ts";
const FIXTURE_TILE_SOURCE = `import { Sensor, type Context } from "wendoo";

export default Sensor({
  name: "button-a-pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
`;

/** Asset file seeded into the sample project's workspace. */
const FIXTURE_ASSET_PATH = "assets/logo.svg";
const FIXTURE_ASSET_CONTENT = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>\n';

// The app-host reads localStorage/sessionStorage for its user-tile cache; provide an in-memory shim
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

let storeCounter = 0;

/** Deterministic [0,1) generator so seeded brain and page ids are reproducible. */
function seededRandom(): () => number {
  let state = 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Builds a sample `.wendoo` document through the real export path, from a seeded environment so the
 * brain ids are reproducible. Drives `buildMicrobitSimExportDocument` - the code the store exports
 * through - so the committed fixture is provably code-generated.
 */
async function generateFixtureDocument(): Promise<string> {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const host = new AppEnvironmentHost({
    projectManager: new ProjectManager(await createIdbProjectStore(`fixture-gen-${storeCounter++}`)),
    modules: [coreModule(), createWodalSharedModule(), profile.createWendooModule()],
    mounts: [],
    rng: { next: seededRandom() },
  });
  await host.initialize("Sample Project");

  await host.projectManager.updateActive({ extensions: FIXTURE_EXTENSIONS });

  host.projectFileSystem.applyLocalChange({
    action: "write",
    path: FIXTURE_TILE_PATH,
    content: FIXTURE_TILE_SOURCE,
    newEtag: "fixture-tile",
  });
  host.projectFileSystem.applyLocalChange({
    action: "write",
    path: FIXTURE_ASSET_PATH,
    content: FIXTURE_ASSET_CONTENT,
    newEtag: "fixture-asset",
  });

  const blink = host.env.withServices((services) => BrainDef.emptyBrainDef(services, "Blink"));
  await host.saveBrainForKey(blink.id(), blink);
  const button = host.env.withServices((services) => BrainDef.emptyBrainDef(services, "Button"));
  await host.saveBrainForKey(button.id(), button);

  const document = await buildMicrobitSimExportDocument(host.projectManager, {
    brainOrder: [blink.id(), button.id()],
    simulator: { order: ["microbit-1", "microbit-2"], flash: { "microbit-1": blink.id() } },
  });
  host.dispose();
  return document;
}

describe("sample .wendoo fixture", () => {
  let generated: string;

  before(async () => {
    generated = await generateFixtureDocument();
    // Bootstrap the committed fixture on first run; on later runs the equality
    // test below pins the committed bytes against the export path.
    if (!existsSync(FIXTURE_PATH)) {
      writeFileSync(FIXTURE_PATH, generated);
    }
  });

  it("is byte-for-byte what the export code generates", () => {
    assert.equal(generated, readFileSync(FIXTURE_PATH, "utf8"));
  });

  it("carries the whole project: tile source, asset, brains, and the app chunk", () => {
    const document = JSON.parse(generated) as {
      manifest: {
        brains: Record<string, { name: string }>;
        app: Record<string, unknown>;
        extensions: Record<string, string>;
      };
      contents: Record<string, string>;
    };

    assert.equal(document.contents[FIXTURE_TILE_PATH], FIXTURE_TILE_SOURCE);
    assert.equal(document.contents[FIXTURE_ASSET_PATH], FIXTURE_ASSET_CONTENT);

    assert.deepEqual(
      Object.values(document.manifest.brains)
        .map((brain) => brain.name)
        .sort(),
      ["Blink", "Button"]
    );

    const appChunk = parseMicrobitSimAppChunk(document.manifest.app[appName]);
    assert.equal(appChunk.brainOrder.length, 2);
    assert.deepEqual(appChunk.simulator?.order, ["microbit-1", "microbit-2"]);

    assert.deepEqual(document.manifest.extensions, FIXTURE_EXTENSIONS);
  });

  it("imports through the real seam, seeding brains and the flashed fleet", async () => {
    const projectStore = await createIdbProjectStore(`fixture-import-${storeCounter++}`);
    const projectManager = new ProjectManager(projectStore);
    await projectManager.init();

    const file = new File([readFileSync(FIXTURE_PATH, "utf8")], "sample-project.wendoo");
    const result = await importProjectDocument(file, appName, projectManager, {
      // The store's import callback: seed microbit-sim's session chunk into app-data.
      appChunkCallback: translateMicrobitSimAppChunk,
    });

    assert.equal(result.success, true);
    const projectId = result.projectId!;

    const brains = JSON.parse((await projectStore.loadAppData(projectId, "brains"))!) as Record<
      string,
      { name: string }
    >;
    assert.deepEqual(
      Object.values(brains)
        .map((brain) => brain.name)
        .sort(),
      ["Blink", "Button"]
    );

    const brainsIndex = JSON.parse((await projectStore.loadAppData(projectId, BRAINS_INDEX_KEY))!) as string[];
    assert.deepEqual([...brainsIndex].sort(), Object.keys(brains).sort());

    const fleet = JSON.parse((await projectStore.loadAppData(projectId, SIMULATOR_STATE_KEY))!) as {
      order: string[];
      flash: Record<string, string>;
    };
    assert.deepEqual(fleet.order, ["microbit-1", "microbit-2"]);
    assert.equal(Object.keys(fleet.flash).length, 1);
    assert.equal(fleet.flash["microbit-1"], brainsIndex[0]);

    const manifest = await projectStore.getProject(projectId);
    assert.ok(manifest);
    assert.deepEqual(manifest.extensions, FIXTURE_EXTENSIONS);
  });
});
