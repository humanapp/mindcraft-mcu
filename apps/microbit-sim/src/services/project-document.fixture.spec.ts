import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createIdbProjectStore, importProjectDocument, ProjectManager } from "@mindcraft-lang/app-host";
import { AppEnvironmentHost } from "@mindcraft-lang/bridge-app";
import { BrainDef, coreModule } from "@mindcraft-lang/core/app";
import {
  createWodalSharedModule,
  getWodalDeviceProfile,
  validateWodalTarget,
  WodalDeviceProfileId,
} from "@mindcraft-lang/wodal";
import { name as appName, version as appVersion } from "../../package.json";
import {
  BRAINS_INDEX_KEY,
  buildMicrobitSimExportDocument,
  parseMicrobitSimTarget,
  SIMULATOR_STATE_KEY,
} from "./project-io";

const FIXTURE_PATH = fileURLToPath(new URL("./__fixtures__/sample-project.mindcraft", import.meta.url));

/** Extension dependencies seeded into the sample project, coordinate-keyed, one per reference form. */
const FIXTURE_EXTENSIONS = {
  "example-org/mindcraft-position": "gh:example-org/mindcraft-position@v1.2.0",
  "mindcraft-lang/codal": "embedded:mindcraft-lang/codal",
  "author/scratch": "local:8f14e45f-ceea-4e17-a396-7f34c2d51b3a",
};

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
 * Builds a sample `.mindcraft` document through the real export path, from a seeded environment so the
 * brain ids are reproducible. Drives `buildMicrobitSimExportDocument` - the code the store exports
 * through - so the committed fixture is provably code-generated.
 */
async function generateFixtureDocument(): Promise<string> {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const host = new AppEnvironmentHost({
    projectManager: new ProjectManager(await createIdbProjectStore(`fixture-gen-${storeCounter++}`)),
    modules: [coreModule(), createWodalSharedModule(), profile.createMindcraftModule()],
    mounts: [],
    rng: { next: seededRandom() },
  });
  await host.initialize("Sample Project");

  await host.projectManager.updateActive({ extensions: FIXTURE_EXTENSIONS });

  const blink = host.env.withServices((services) => BrainDef.emptyBrainDef(services, "Blink"));
  await host.saveBrainForKey(blink.id(), blink);
  const button = host.env.withServices((services) => BrainDef.emptyBrainDef(services, "Button"));
  await host.saveBrainForKey(button.id(), button);

  const document = await buildMicrobitSimExportDocument(host.projectManager, profile.profileId, {
    brainOrder: [blink.id(), button.id()],
    simulator: { order: ["microbit-1", "microbit-2"], flash: { "microbit-1": blink.id() } },
  });
  host.dispose();
  return document;
}

describe("sample .mindcraft fixture", () => {
  let generated: string;

  before(async () => {
    generated = await generateFixtureDocument();
    // Bootstrap the committed fixture on first run; a later drift in the export path fails the equality
    // test below rather than silently rewriting the committed artifact.
    if (!existsSync(FIXTURE_PATH)) {
      writeFileSync(FIXTURE_PATH, generated);
    }
  });

  it("is byte-for-byte what the export code generates", () => {
    assert.equal(generated, readFileSync(FIXTURE_PATH, "utf8"));
  });

  it("imports through the real seam, seeding brains and the flashed fleet", async () => {
    const projectStore = await createIdbProjectStore(`fixture-import-${storeCounter++}`);
    const projectManager = new ProjectManager(projectStore);
    await projectManager.init();

    const file = new File([readFileSync(FIXTURE_PATH, "utf8")], "sample-project.mindcraft");
    const result = await importProjectDocument(file, appName, appVersion, projectManager, {
      // The store's targetsCallback over the same building blocks: validate the WODAL target, then seed
      // microbit-sim's payload into app-data.
      targetsCallback: (targets, appTarget) => {
        const wodal = validateWodalTarget(targets);
        if (!wodal.ok) {
          return { diagnostics: wodal.errors.map((error) => ({ severity: "error" as const, message: error.message })) };
        }
        const app = parseMicrobitSimTarget(appTarget);
        const appData: Record<string, string> = {};
        if (app.brainOrder.length > 0) {
          appData[BRAINS_INDEX_KEY] = JSON.stringify(app.brainOrder);
        }
        if (app.simulator) {
          appData[SIMULATOR_STATE_KEY] = JSON.stringify(app.simulator);
        }
        return { diagnostics: [], appData };
      },
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
