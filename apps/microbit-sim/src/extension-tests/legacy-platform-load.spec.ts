import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ExtensionFetchTransport } from "@mindcraft-lang/app-host";
import {
  createIdbProjectStore,
  DEFAULT_PROJECT_NAME,
  importProjectDocument,
  type ProjectFileSnapshot,
  ProjectManager,
  parseExtensionReference,
} from "@mindcraft-lang/app-host";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import {
  AppEnvironmentHost,
  CatalogMoveWarningCode,
  INSTALLED_EXTENSIONS_APP_DATA_KEY,
} from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { coreModule } from "@mindcraft-lang/core/app";
import type { IBrainDef, IBrainRuleDef, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { createProfileNumerics } from "@mindcraft-lang/core/runtime";
import { isCompilerControlledPath, type WorkspaceCompileResult } from "@mindcraft-lang/ts-compiler";
import { createWodalSharedModule, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { microbitLibraryCatalogMoves } from "../services/microbit-extension-browser";
import {
  CODAL_LIB_COORDINATE,
  CODAL_POSITION_EXT_COORDINATE,
  CORE_LIB_COORDINATE,
  CUTEBOT_EXT_COORDINATE,
  CUTEBOT_EXT_REFERENCE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_TARGET_COORDINATE,
  MICROBIT_V2_TARGET_REFERENCE,
  microbitDefaultExtensions,
  YAHBOOM_GAMEPAD_EXT_COORDINATE,
  YAHBOOM_GAMEPAD_EXT_REFERENCE,
} from "../services/microbit-extension-coordinates";
import { MICROBIT_SIM_APP_CHUNK_KEY, translateMicrobitSimAppChunk } from "../services/project-io";
import { unresolvedLibraryCoordinates } from "../services/resolution-warnings";
import { CODAL_POSITION_GH_REF, createCodalPositionFixtureTransport } from "./codal-position-fixture";

// The app-host reads localStorage/sessionStorage; provide an in-memory shim
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

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The app's full embed record: the same six coordinate/directory registrations
 * as `vite/embedded-extensions.mjs`, assembled through
 * {@link buildEmbeddedExtensionFromDir}, the single content-assembly path the
 * app's Vite provider also uses.
 */
function appEmbedRecord(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(extensionDir("../../target-package"), MICROBIT_V2_TARGET_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../packages/wodal/targets/microbit-v2/lib"),
      MICROBIT_V2_LIB_COORDINATE
    ),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/wodal/lib"), CODAL_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../external/mindcraft-lang/packages/core/lib"),
      CORE_LIB_COORDINATE
    ),
    buildEmbeddedExtensionFromDir(extensionDir("../../extensions/lib-microbit-cutebot"), CUTEBOT_EXT_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../extensions/lib-microbit-yahboom-gamepad"),
      YAHBOOM_GAMEPAD_EXT_COORDINATE
    ),
  ];
}

/**
 * The legacy project's top-level extensions map: the old platform-in-extensions
 * shape, where the runnable target and the two chassis add-ons are the only
 * entries and the platform layers are expected to resolve transitively.
 */
const LEGACY_EXTENSIONS: Readonly<Record<string, string>> = {
  [MICROBIT_V2_TARGET_COORDINATE]: MICROBIT_V2_TARGET_REFERENCE,
  [YAHBOOM_GAMEPAD_EXT_COORDINATE]: YAHBOOM_GAMEPAD_EXT_REFERENCE,
  [CUTEBOT_EXT_COORDINATE]: CUTEBOT_EXT_REFERENCE,
};

const MY_ACTUATOR_PATH = "my-actuator/my-actuator.ts";
const MY_ACTUATOR_SOURCE = `import { Actuator } from "mindcraft";
import { heart } from "@lib/mindcraft-lang/lib-microbit-v2"
const icon = heart();
export default Actuator({ id: "fbkHu4V3tO8EQ8Bd", name: "my actuator", onExecute(ctx, params) {}, });
`;

/** The dependent-library files whose Position imports the load must resolve. */
const POSITION_DEPENDENT_PATHS: readonly string[] = [
  `.libraries/${CUTEBOT_EXT_COORDINATE}/steer.ts`,
  `.libraries/${YAHBOOM_GAMEPAD_EXT_COORDINATE}/stick-position.ts`,
  `.libraries/${YAHBOOM_GAMEPAD_EXT_COORDINATE}/decoded-stick-position.ts`,
  `.libraries/${YAHBOOM_GAMEPAD_EXT_COORDINATE}/position-to-buffer.ts`,
];

/** Wrap the fixture transport with a fetch-call counter, so a load's fetch activity is observable. */
function countingTransport(): { transport: ExtensionFetchTransport; fetchCount: () => number } {
  const inner = createCodalPositionFixtureTransport();
  let calls = 0;
  return {
    fetchCount: () => calls,
    transport: {
      async fetchFile(owner, repo, pin, path) {
        calls += 1;
        return inner.fetchFile(owner, repo, pin, path);
      },
      resolveBranch: inner.resolveBranch.bind(inner),
      listVersionTags: inner.listVersionTags.bind(inner),
    },
  };
}

let storeCounter = 0;

/**
 * The host exactly as `MicrobitSimEnvironmentStore.create()` constructs it in
 * browser mode, with the headless substitutions stated where they occur: the
 * IDB store runs over fake-indexeddb, the jsDelivr transport is replaced by the
 * Position fetch fixture (no network in tests), and the Web Locks project lock
 * and the bridge URL are omitted (browser-only surfaces the load path never
 * consumes before `initBridge`).
 */
async function makeProductionShapedHost(transport: ExtensionFetchTransport): Promise<{
  host: AppEnvironmentHost;
  projectManager: ProjectManager;
  lastCompile: () => WorkspaceCompileResult | undefined;
}> {
  const activeProfile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  const projectStore = await createIdbProjectStore(`legacy-platform-load-${storeCounter++}`);
  let lastCompile: WorkspaceCompileResult | undefined;
  const projectManager = new ProjectManager(projectStore, {
    filesystemOptions: {
      shouldExclude: (path) => isCompilerControlledPath(path, []),
    },
    defaultExtensions: microbitDefaultExtensions,
  });
  const host = new AppEnvironmentHost({
    projectManager,
    modules: [coreModule(), createWodalSharedModule(), activeProfile.createMindcraftModule()],
    numerics: createProfileNumerics(activeProfile.numberPrecision),
    mounts: [],
    embeddedExtensions: appEmbedRecord(),
    extensionFetchTransport: transport,
    catalogMoves: microbitLibraryCatalogMoves,
    rng: { next: () => Math.random() },
    onDidCompile: (result) => {
      lastCompile = result;
    },
  });
  return { host, projectManager, lastCompile: () => lastCompile };
}

/**
 * Seed the legacy "cuterbot" project into the durable store: the three-entry
 * manifest extensions map and the user-content actuator file. `appData` seeds
 * the project's persisted app-data records (empty for a project saved before
 * any snapshot existed).
 */
async function seedLegacyProject(
  projectManager: ProjectManager,
  appData: Record<string, string> = {}
): Promise<string> {
  const snapshot: ProjectFileSnapshot = new Map([
    [MY_ACTUATOR_PATH, { kind: "file", content: MY_ACTUATOR_SOURCE, etag: "e1", isReadonly: false }],
  ]);
  const created = await projectManager.createFromSnapshot(
    "cuterbot",
    "",
    snapshot,
    appData,
    undefined,
    LEGACY_EXTENSIONS,
    "0.1.0"
  );
  return created.id;
}

/** Error-severity diagnostic entries recorded for `path` in the compile result. */
function errorsAt(result: WorkspaceCompileResult | undefined, path: string): readonly { code: string }[] {
  return (result?.files.get(path) ?? []).filter((entry) => entry.severity === "error");
}

/** One production-shaped load of the legacy project through the picker's path: startup, seed, switch. */
async function loadLegacyProject(appData: Record<string, string> = {}): Promise<{
  host: AppEnvironmentHost;
  fetchesDuringSwitch: number;
  result: WorkspaceCompileResult | undefined;
}> {
  const { transport, fetchCount } = countingTransport();
  const { host, projectManager, lastCompile } = await makeProductionShapedHost(transport);
  // App startup: opens/creates the default project, as store.initialize does.
  await host.initialize(DEFAULT_PROJECT_NAME);
  const startupFetches = fetchCount();
  const legacyId = await seedLegacyProject(projectManager, appData);
  // The picker's load path: store.switchProject delegates here directly.
  await host.switchProject(legacyId);
  return { host, fetchesDuringSwitch: fetchCount() - startupFetches, result: lastCompile() };
}

describe("legacy project load -- production wiring", () => {
  test("the load-path self-heal fetches the moved Position dep and resolves it for the dependents", async () => {
    const { host, fetchesDuringSwitch, result } = await loadLegacyProject();
    try {
      // The cutebot/yahboom embedded Position deps redirect through the catalog
      // move to the pinned gh: reference, which this project never persisted;
      // the load must fetch it.
      assert.ok(fetchesDuringSwitch > 0, "the load fetched the moved Position content through the transport");
      assert.equal(
        host.getInstalledExtensionMetadata()[CODAL_POSITION_EXT_COORDINATE]?.reference,
        CODAL_POSITION_GH_REF,
        "the healed Position snapshot persisted under the pinned gh: reference"
      );
      const installed = host.installedLibraries.map((library) => library.coordinate);
      assert.ok(installed.includes(CODAL_POSITION_EXT_COORDINATE), "Position resolved into the installed closure");
      assert.ok(result, "expected a compile result for the legacy project");
      for (const path of POSITION_DEPENDENT_PATHS) {
        assert.deepEqual(
          errorsAt(result, path).map((entry) => entry.code),
          [],
          `expected no error diagnostics in ${path}`
        );
      }
    } finally {
      host.dispose();
    }
  });

  test("the load persists no platform layer or transitive dependency into the manifest extensions map", async () => {
    const { host } = await loadLegacyProject();
    try {
      assert.deepEqual(
        Object.keys(host.activeProjectManifest?.extensions ?? {}).sort(),
        Object.keys(LEGACY_EXTENSIONS).sort(),
        "the manifest extensions map keeps exactly its own entries"
      );
    } finally {
      host.dispose();
    }
  });

  // The platform stack reached through the target's `targets` edges joins the
  // project's direct dependencies, so user content may import any of its
  // layers.
  test("user content importing the transitively-reached platform stdlib compiles", async () => {
    const { host, result } = await loadLegacyProject();
    try {
      assert.ok(result, "expected a compile result for the legacy project");
      // The stack DID materialize: the stdlib layer is in the resolved closure.
      const installed = host.installedLibraries.map((library) => library.coordinate);
      assert.ok(installed.includes(MICROBIT_V2_LIB_COORDINATE), "the stdlib layer resolved into the closure");
      // The user-content import of that same layer must resolve too.
      assert.deepEqual(
        errorsAt(result, MY_ACTUATOR_PATH).map((entry) => entry.code),
        [],
        `expected no error diagnostics in ${MY_ACTUATOR_PATH}`
      );
    } finally {
      host.dispose();
    }
  });

  // A persisted installed-extensions record whose reference matches the move's
  // pin but whose files carry no parseable manifest is unusable content: the
  // heal walk treats it as missing, refetches, and replaces the record, with
  // zero user action.
  test("a corrupt stored Position snapshot is detected and re-fetched instead of silently mounting nothing", async () => {
    const parsed = parseExtensionReference(CODAL_POSITION_GH_REF);
    assert.ok(parsed?.transport === "gh" && parsed.routing.kind === "pin", "the move ref is a pinned gh: reference");
    const poisonedSnapshots = JSON.stringify({
      [CODAL_POSITION_EXT_COORDINATE]: {
        reference: CODAL_POSITION_GH_REF,
        specifier: parsed.routing.pin,
        files: {},
      },
    });
    const { host, fetchesDuringSwitch, result } = await loadLegacyProject({
      [INSTALLED_EXTENSIONS_APP_DATA_KEY]: poisonedSnapshots,
    });
    try {
      assert.ok(result, "expected a compile result for the legacy project");
      assert.ok(fetchesDuringSwitch > 0, "the load re-fetched the unusable stored Position content");
      for (const path of POSITION_DEPENDENT_PATHS) {
        assert.deepEqual(
          errorsAt(result, path).map((entry) => entry.code),
          [],
          `expected no error diagnostics in ${path}`
        );
      }
    } finally {
      host.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// The .mindcraft IMPORT path: a shared export document imported as a new
// project. Unlike the picker path above, the imported project's app data
// carries the export's saved brains but never the installed-extensions
// snapshots (an export is portable and omits them), so the first load after
// import always resolves before the Position heal has fetched anything.
// ---------------------------------------------------------------------------

/** Brain keys of the export's stored brains record. */
const REMOTE_BRAIN_KEY = "gkIOi3pfMfDsy6yC";
const DRIVE_BRAIN_KEY = "6r44shQiaucjP4ar";

/**
 * A Cutebot actuator instance in the persisted form the current editor
 * serializes for a foreign-namespace library tile: the library's stable action
 * id under its coordinate namespace.
 */
const CUTEBOT_DRIVE_TILE_REF = {
  k: "action",
  area: "actuator",
  id: "zClgsu5drwdekq7r",
  ns: CUTEBOT_EXT_COORDINATE,
} as const;

/** A Yahboom stick sensor instance in the same persisted form. */
const YAHBOOM_STICK_TILE_REF = {
  k: "action",
  area: "sensor",
  id: "qyPhWctORp9bXYAc",
  ns: YAHBOOM_GAMEPAD_EXT_COORDINATE,
} as const;

/** Runtime tile ids the persisted refs above decode to. */
const CUTEBOT_DRIVE_TILE_ID = `tile.actuator->${CUTEBOT_EXT_COORDINATE}:user.actuator.${CUTEBOT_DRIVE_TILE_REF.id}`;
const YAHBOOM_STICK_TILE_ID = `tile.sensor->${YAHBOOM_GAMEPAD_EXT_COORDINATE}:user.sensor.${YAHBOOM_STICK_TILE_REF.id}`;

/** Platform host-action tile ids, serialized as plain strings in the export's brains. */
const RADIO_SEND_TILE_ID = "tile.actuator->microbit-v2.radio-send";
const RADIO_RECEIVE_BUFFER_TILE_ID = "tile.sensor->microbit-v2.radio-receive-buffer";

/** The export's user-content file, importing the target coordinate (whose hostApp package lists no files). */
const STALE_TRG_IMPORT_SOURCE = `import { Actuator } from "mindcraft";
import { heart } from "@lib/mindcraft-lang/trg-microbit-v2"

const icon = heart();

export default Actuator({
  id: "fbkHu4V3tO8EQ8Bd",
  name: "my actuator",
  onExecute(ctx, params) {
  },
});
`;

/**
 * The user's "cuterbot" export document: the real file's manifest, brains, app
 * chunk, and contents, with each brain's second (empty) rule holding the
 * Cutebot/Yahboom tile instances the live brains held, in the persisted form
 * the current editor writes.
 */
function cuterbotDocumentText(): string {
  return JSON.stringify({
    format: "mindcraft.project/2",
    manifest: {
      name: "cuterbot",
      version: "0.1.0",
      description: "",
      extensions: {
        [MICROBIT_V2_TARGET_COORDINATE]: MICROBIT_V2_TARGET_REFERENCE,
        [YAHBOOM_GAMEPAD_EXT_COORDINATE]: YAHBOOM_GAMEPAD_EXT_REFERENCE,
        [CUTEBOT_EXT_COORDINATE]: CUTEBOT_EXT_REFERENCE,
      },
      brains: {
        [REMOTE_BRAIN_KEY]: {
          version: 1,
          id: "ttD0r70L1Z20Sp8b",
          name: "robot remote",
          catalog: [{ version: 2, kind: "page", pageId: "ZOygVYKtp5pfVXG0", label: "Unnamed Page" }],
          pages: [
            {
              version: 2,
              pageId: "ZOygVYKtp5pfVXG0",
              name: "Unnamed Page",
              rules: [
                { version: 1, when: [], do: [RADIO_SEND_TILE_ID], children: [] },
                { version: 1, when: [YAHBOOM_STICK_TILE_REF], do: [CUTEBOT_DRIVE_TILE_REF], children: [] },
              ],
            },
          ],
        },
        [DRIVE_BRAIN_KEY]: {
          version: 1,
          id: "ms5n5wbY5nGdb7Wg",
          name: "robot drive",
          catalog: [{ version: 2, kind: "page", pageId: "mNdhCKxdpaw2ZvTj", label: "Unnamed Page" }],
          pages: [
            {
              version: 2,
              pageId: "mNdhCKxdpaw2ZvTj",
              name: "Unnamed Page",
              rules: [
                { version: 1, when: [RADIO_RECEIVE_BUFFER_TILE_ID], do: [CUTEBOT_DRIVE_TILE_REF], children: [] },
                { version: 1, when: [], do: [], children: [] },
              ],
            },
          ],
        },
      },
      app: {
        [MICROBIT_SIM_APP_CHUNK_KEY]: {
          brainOrder: [REMOTE_BRAIN_KEY, DRIVE_BRAIN_KEY],
          simulator: {
            order: ["1bc5a8a8-097c-488f-a3fa-45422f0f98a1", "00897593-2fd3-4281-8e86-ff88909d570a"],
            flash: {
              "1bc5a8a8-097c-488f-a3fa-45422f0f98a1": REMOTE_BRAIN_KEY,
              "00897593-2fd3-4281-8e86-ff88909d570a": DRIVE_BRAIN_KEY,
            },
          },
        },
      },
    },
    contents: { [MY_ACTUATOR_PATH]: STALE_TRG_IMPORT_SOURCE },
  });
}

/** Every tile placed on a rule of the brain, when and do sides, child rules included. */
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

/** The kinds of the brain's placed tiles matching `tileId`, in placement order. */
function kindsOfTile(brainDef: IBrainDef, tileId: string): string[] {
  return collectRuleTiles(brainDef)
    .filter((tile) => tile.tileId === tileId)
    .map((tile) => tile.kind);
}

/**
 * One production-shaped import of the cuterbot export: startup on the default
 * project, `importProjectDocument` with the app's chunk translator, then the
 * switch to the created project -- the exact sequence of
 * `MicrobitSimEnvironmentStore.importProject`.
 */
async function importCuterbotProject(transport: ExtensionFetchTransport = countingTransport().transport): Promise<{
  host: AppEnvironmentHost;
  projectManager: ProjectManager;
  defaultProjectId: string;
  importedProjectId: string;
  result: WorkspaceCompileResult | undefined;
}> {
  const { host, projectManager, lastCompile } = await makeProductionShapedHost(transport);
  await host.initialize(DEFAULT_PROJECT_NAME);
  const defaultProjectId = projectManager.activeProject!.manifest.id;
  const file = new File([cuterbotDocumentText()], "cuterbot.mindcraft");
  const imported = await importProjectDocument(file, MICROBIT_SIM_APP_CHUNK_KEY, projectManager, {
    appChunkCallback: translateMicrobitSimAppChunk,
  });
  assert.equal(imported.success, true, JSON.stringify(imported.diagnostics));
  assert.deepEqual(
    imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    [],
    "the import surface reports no errors for this document"
  );
  await host.switchProject(imported.projectId!);
  return { host, projectManager, defaultProjectId, importedProjectId: imported.projectId!, result: lastCompile() };
}

/** The fixture transport behind a controllable outage: while down, every request answers not-found. */
function outageTransport(): { transport: ExtensionFetchTransport; restore: () => void } {
  const inner = createCodalPositionFixtureTransport();
  let down = true;
  return {
    restore: () => {
      down = false;
    },
    transport: {
      async fetchFile(owner, repo, pin, path) {
        if (down) return { ok: false, kind: "not-found" };
        return inner.fetchFile(owner, repo, pin, path);
      },
      async resolveBranch(owner, repo, branch) {
        if (down) return { ok: false, kind: "not-found" };
        return inner.resolveBranch(owner, repo, branch);
      },
      async listVersionTags(owner, repo) {
        if (down) return { ok: false, kind: "not-found" };
        return inner.listVersionTags(owner, repo);
      },
    },
  };
}

/** The stored remote brain's rule arrays, parsed from the active project's persisted brains record. */
async function storedRemoteRules(
  projectManager: ProjectManager
): Promise<readonly { when: unknown[]; do: unknown[] }[]> {
  const raw = await projectManager.loadAppData("brains");
  assert.ok(raw, "the project persisted a brains record");
  const record = JSON.parse(raw) as Record<string, { pages: { rules: { when: unknown[]; do: unknown[] }[] }[] }>;
  return record[REMOTE_BRAIN_KEY].pages[0].rules;
}

describe("cuterbot .mindcraft import -- production wiring", () => {
  // The load-time heal registers the library tiles (the picker's source), so
  // the same load must resolve the saved brains' instances of those tiles.
  test("brain instances of library tiles resolve to the tiles the same load registers", async () => {
    const { host, result } = await importCuterbotProject();
    try {
      // Picker side: the load's final compile registered both library tiles.
      const bundleTileIds = (result?.bundle?.tiles ?? []).map((tile) => tile.tileId);
      assert.ok(bundleTileIds.includes(CUTEBOT_DRIVE_TILE_ID), "the Cutebot tile is registered for the picker");
      assert.ok(bundleTileIds.includes(YAHBOOM_STICK_TILE_ID), "the Yahboom tile is registered for the picker");
      // Brain side: the saved instances of those same tiles must resolve too.
      const remote = host.getCachedBrain(REMOTE_BRAIN_KEY);
      const drive = host.getCachedBrain(DRIVE_BRAIN_KEY);
      assert.ok(remote, "the imported remote brain deserialized into the cache");
      assert.ok(drive, "the imported drive brain deserialized into the cache");
      assert.deepEqual(kindsOfTile(remote, CUTEBOT_DRIVE_TILE_ID), ["actuator"]);
      assert.deepEqual(kindsOfTile(remote, YAHBOOM_STICK_TILE_ID), ["sensor"]);
      assert.deepEqual(kindsOfTile(drive, CUTEBOT_DRIVE_TILE_ID), ["actuator"]);
    } finally {
      host.dispose();
    }
  });

  // While the moved Position content is unreachable, both libraries' tile sets
  // are withheld and the saved instances load as missing-tile placeholders.
  // The placeholders must be lossless through every persistence path -- an
  // explicit save, a save after an edit elsewhere in the same brain, and the
  // switch-away flush -- and resolve to the original tiles once the content
  // heals.
  test("missing-tile placeholders survive save and edit cycles verbatim and resolve after the heal", async () => {
    const { transport, restore } = outageTransport();
    const { host, projectManager, defaultProjectId, importedProjectId } = await importCuterbotProject(transport);
    try {
      const remote = host.getCachedBrain(REMOTE_BRAIN_KEY);
      assert.ok(remote, "the imported remote brain deserialized into the cache");
      // The outage withheld the library tiles: the saved instances are placeholders.
      assert.deepEqual(kindsOfTile(remote, CUTEBOT_DRIVE_TILE_ID), ["missing"]);
      assert.deepEqual(kindsOfTile(remote, YAHBOOM_STICK_TILE_ID), ["missing"]);

      // Write 1: an explicit save of the loaded brain.
      await host.saveBrainForKey(REMOTE_BRAIN_KEY, remote);
      let rules = await storedRemoteRules(projectManager);
      assert.deepEqual(rules[1].when, [YAHBOOM_STICK_TILE_REF]);
      assert.deepEqual(rules[1].do, [CUTEBOT_DRIVE_TILE_REF]);

      // Write 2: an edit elsewhere in the same brain -- the radio rule gains a
      // platform sensor -- then a save of the edited brain.
      const radioReceive = host.env.brainServices.edit.tiles.get(RADIO_RECEIVE_BUFFER_TILE_ID);
      assert.ok(radioReceive, "the platform radio sensor tile is registered");
      remote.pages().get(0)!.children().get(0)!.when().appendTile(radioReceive);
      await host.saveBrainForKey(REMOTE_BRAIN_KEY, remote);
      rules = await storedRemoteRules(projectManager);
      assert.deepEqual(rules[0].when, [RADIO_RECEIVE_BUFFER_TILE_ID]);
      assert.deepEqual(rules[1].when, [YAHBOOM_STICK_TILE_REF]);
      assert.deepEqual(rules[1].do, [CUTEBOT_DRIVE_TILE_REF]);

      // Write 3: the switch-away flush persists the cached placeholder brains;
      // the content heals before the switch back.
      restore();
      await host.switchProject(defaultProjectId);
      await host.switchProject(importedProjectId);
      rules = await storedRemoteRules(projectManager);
      assert.deepEqual(rules[0].when, [RADIO_RECEIVE_BUFFER_TILE_ID]);
      assert.deepEqual(rules[1].when, [YAHBOOM_STICK_TILE_REF]);
      assert.deepEqual(rules[1].do, [CUTEBOT_DRIVE_TILE_REF]);
      // The same persisted instances now resolve to the original tiles.
      const healed = host.getCachedBrain(REMOTE_BRAIN_KEY);
      assert.ok(healed, "the remote brain reloaded after the heal");
      assert.deepEqual(kindsOfTile(healed, CUTEBOT_DRIVE_TILE_ID), ["actuator"]);
      assert.deepEqual(kindsOfTile(healed, YAHBOOM_STICK_TILE_ID), ["sensor"]);
      assert.deepEqual(kindsOfTile(healed, RADIO_RECEIVE_BUFFER_TILE_ID), ["sensor"]);
    } finally {
      host.dispose();
    }
  });

  // The store's warning surface delegates to the host's resolution-warning
  // snapshot; this exercises it through the same production wiring: an outage
  // load records the stable-coded move failure, and the healed load clears it.
  test("an outage load exposes the stable-coded move warning and the healed load clears it", async () => {
    const { transport, restore } = outageTransport();
    const { host, defaultProjectId, importedProjectId } = await importCuterbotProject(transport);
    try {
      const warnings = host.getResolutionWarningsSnapshot();
      assert.ok(
        warnings.some(
          (warning) =>
            warning.kind === "catalog-move-failed" &&
            warning.code === CatalogMoveWarningCode.FETCH_FAILED &&
            warning.origin === CODAL_POSITION_EXT_COORDINATE
        ),
        `the outage load records the move-fetch failure: ${JSON.stringify(warnings)}`
      );
      // The indicator model derives exactly the failed library's coordinate.
      assert.deepEqual(unresolvedLibraryCoordinates(warnings), [CODAL_POSITION_EXT_COORDINATE]);

      let notified = 0;
      host.subscribeToResolutionWarnings(() => {
        notified += 1;
      });
      restore();
      await host.switchProject(defaultProjectId);
      await host.switchProject(importedProjectId);
      assert.ok(notified > 0, "the healed load notified the warning subscriber");
      assert.deepEqual(
        unresolvedLibraryCoordinates(host.getResolutionWarningsSnapshot()),
        [],
        "no library remains unresolved after the heal"
      );
    } finally {
      host.dispose();
    }
  });

  // The export's platform tile refs serialize as plain host-action tile ids
  // whose keys are stable; they resolve against the module catalog on load.
  test("the export's platform radio tile refs resolve on import", async () => {
    const { host } = await importCuterbotProject();
    try {
      const remote = host.getCachedBrain(REMOTE_BRAIN_KEY);
      const drive = host.getCachedBrain(DRIVE_BRAIN_KEY);
      assert.ok(remote, "the imported remote brain deserialized into the cache");
      assert.ok(drive, "the imported drive brain deserialized into the cache");
      assert.deepEqual(kindsOfTile(remote, RADIO_SEND_TILE_ID), ["actuator"]);
      assert.deepEqual(kindsOfTile(drive, RADIO_RECEIVE_BUFFER_TILE_ID), ["sensor"]);
    } finally {
      host.dispose();
    }
  });
});
