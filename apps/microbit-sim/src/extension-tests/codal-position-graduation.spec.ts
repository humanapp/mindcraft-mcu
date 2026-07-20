/**
 * Acceptance coverage for graduating the Position library from a host-bundled
 * embedded add-on to a published (`gh:`) library, redirected by a bundled
 * catalog transport-flip move. Proves four behaviors of the flip:
 *
 * - DIRECT: Position is a compatibility-filtered `gh:` catalog offer, and
 *   installing it resolves its published content through the fetch fixture and
 *   registers its `Position` struct type.
 * - TRANSITIVE REDIRECT: the Cutebot and Yahboom add-ons keep their
 *   `embedded:` dependency on Position, yet with the embedded copy removed
 *   their dep resolves ONLY through the move to the `gh:` reference. Red-first:
 *   with no move the dep does not resolve at all.
 * - EMBEDDED GONE: Position is absent from the embed record, and an `embedded:`
 *   reference to it no longer resolves; only the `gh:` path does.
 * - PROJECT MIGRATION: a saved project whose top-level manifest references
 *   Position through `embedded:` is rewritten to the `gh:` reference by the
 *   host's load-time move rewrite, and the migrated project still resolves it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ActiveProject,
  createInMemoryProjectFileSystem,
  type ProjectFileSystem,
  type ProjectManager,
} from "@mindcraft-lang/app-host";
import { AppEnvironmentHost, type EmbeddedExtension, resolveProjectExtensions } from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { coreModule } from "@mindcraft-lang/core/app";
import { createProfileNumerics } from "@mindcraft-lang/core/runtime";
import { createWodalSharedModule, getWodalDeviceProfile, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import {
  buildMicrobitCatalogOffers,
  buildMicrobitExtensionEntries,
  microbitLibraryCatalogMoves,
} from "../services/microbit-extension-browser";
import {
  CODAL_LIB_COORDINATE,
  CODAL_POSITION_EXT_COORDINATE,
  CORE_LIB_COORDINATE,
  CUTEBOT_EXT_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  MICROBIT_V2_TARGET_COORDINATE,
  MICROBIT_V2_TARGET_REFERENCE,
  microbitDefaultExtensions,
  YAHBOOM_GAMEPAD_EXT_COORDINATE,
} from "../services/microbit-extension-coordinates";
import {
  CODAL_POSITION_GH_REF,
  codalPositionPublishedFetched,
  createCodalPositionFixtureTransport,
} from "./codal-position-fixture";
import { buildExtensionTestHarness } from "./extension-test-harness";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The microbit-sim embed record after graduation: the target, the three
 * platform layers, and the Cutebot and Yahboom add-ons. Position is deliberately
 * absent -- it resolves through the catalog move to its published gh: content.
 */
function embedRecordWithoutPosition(): EmbeddedExtension[] {
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

/** The resolver content sources after graduation: the embed record plus the fixture-served Position gh: content and the catalog moves. */
function sourcesWithMove() {
  return {
    embedded: embedRecordWithoutPosition(),
    fetched: codalPositionPublishedFetched,
    moves: microbitLibraryCatalogMoves,
  };
}

describe("Position graduation -- unlisted but resolvable", () => {
  test("Position is not a featured catalog offer or entry for a fresh microbit project", () => {
    const project = { [MICROBIT_V2_TARGET_COORDINATE]: MICROBIT_V2_TARGET_REFERENCE };
    // Position is a transitive sub-dependency of the featured chassis libraries;
    // the canonical listing rule keeps such sub-deps unlisted. It is redirected
    // by the transport-flip move, never surfaced as its own offer or card.
    const offers = buildMicrobitCatalogOffers(project, embedRecordWithoutPosition());
    assert.equal(
      offers.find((offer) => offer.coordinate === CODAL_POSITION_EXT_COORDINATE),
      undefined,
      "Position is not offered"
    );
    const entries = buildMicrobitExtensionEntries(project, embedRecordWithoutPosition());
    assert.equal(
      entries.find((entry) => entry.coordinate === CODAL_POSITION_EXT_COORDINATE),
      undefined,
      "Position is not an entry card"
    );
  });

  test("Position still resolves through the move and registers its Position struct type", () => {
    const harness = buildExtensionTestHarness({ install: [CODAL_POSITION_EXT_COORDINATE] });
    assert.ok(harness.bundle, "the resolved closure compiles a bundle");
    // positionTypeId throws unless the Position type registered from the gh: fixture content.
    assert.ok(harness.positionTypeId(), "the Position struct type is registered from the fixture-served gh: content");
  });
});

describe("Position graduation -- transitive dep-ref redirect", () => {
  for (const dependent of [CUTEBOT_EXT_COORDINATE, YAHBOOM_GAMEPAD_EXT_COORDINATE]) {
    const project = {
      [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
      [dependent]: `embedded:${dependent}`,
    };

    test(`without a move, ${dependent}'s embedded Position dependency does not resolve`, () => {
      const resolved = resolveProjectExtensions(project, { embedded: embedRecordWithoutPosition() });
      const origins = resolved.dependencyMounts.map((mount) => mount.namespace);
      assert.equal(
        origins.includes(CODAL_POSITION_EXT_COORDINATE),
        false,
        "with the embedded copy gone and no move, Position is unresolved"
      );
    });

    test(`with the move, ${dependent}'s embedded Position dependency resolves through the published gh: ref`, () => {
      const resolved = resolveProjectExtensions(project, sourcesWithMove());
      const origin = resolved.origins.find((entry) => entry.origin === CODAL_POSITION_EXT_COORDINATE);
      assert.ok(origin, "Position enters the closure through the move");
      assert.equal(
        origin.reference,
        CODAL_POSITION_GH_REF,
        "Position resolved through the gh: ref, not an embedded one"
      );
    });
  }
});

describe("Position graduation -- a newer published pin is not dragged to the flip pin", () => {
  const NEWER_SHA = "9999999999999999999999999999999999999999";
  const newerReference = `gh:${CODAL_POSITION_EXT_COORDINATE}@${NEWER_SHA}`;
  const DEPENDENT = "example-org/newer-dependent";

  test("a transitive dependency pinned newer than the flip resolves at its own pin", () => {
    const dependent: EmbeddedExtension = {
      canonicalOrigin: DEPENDENT,
      files: [
        { path: "index.ts", content: "export {};" },
        {
          path: "mindcraft.json",
          content: JSON.stringify({
            name: "Newer Dependent",
            version: "0.1.0",
            extensions: { [CODAL_POSITION_EXT_COORDINATE]: newerReference },
          }),
        },
      ],
    };
    const newerContent = codalPositionPublishedFetched.get(CODAL_POSITION_GH_REF);
    assert.ok(newerContent);
    const fetched = new Map([...codalPositionPublishedFetched, [newerReference, newerContent]]);
    const resolved = resolveProjectExtensions(
      { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE, [DEPENDENT]: `embedded:${DEPENDENT}` },
      { embedded: [...embedRecordWithoutPosition(), dependent], fetched, moves: microbitLibraryCatalogMoves }
    );
    const origin = resolved.origins.find((entry) => entry.origin === CODAL_POSITION_EXT_COORDINATE);
    assert.ok(origin, "Position resolves");
    assert.equal(origin.reference, newerReference, "the newer gh pin survives the flip untouched");
  });
});

describe("Position graduation -- embedded transport gone", () => {
  test("Position is not carried in the embed record", () => {
    const origins = embedRecordWithoutPosition().map((extension) => extension.canonicalOrigin);
    assert.equal(origins.includes(CODAL_POSITION_EXT_COORDINATE), false);
  });

  test("an embedded Position reference does not resolve, while the gh: reference does", () => {
    const embeddedProject = {
      [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
      [CODAL_POSITION_EXT_COORDINATE]: `embedded:${CODAL_POSITION_EXT_COORDINATE}`,
    };
    const embeddedResolved = resolveProjectExtensions(embeddedProject, { embedded: embedRecordWithoutPosition() });
    assert.equal(
      embeddedResolved.dependencyMounts.map((mount) => mount.namespace).includes(CODAL_POSITION_EXT_COORDINATE),
      false,
      "the embedded transport no longer serves Position"
    );

    const ghProject = {
      [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
      [CODAL_POSITION_EXT_COORDINATE]: CODAL_POSITION_GH_REF,
    };
    const ghResolved = resolveProjectExtensions(ghProject, {
      embedded: embedRecordWithoutPosition(),
      fetched: codalPositionPublishedFetched,
    });
    assert.ok(
      ghResolved.origins.find((entry) => entry.origin === CODAL_POSITION_EXT_COORDINATE),
      "only the gh: path resolves Position"
    );
  });
});

/** Installs a stub `localStorage` for the duration of a test; returns a restore function. */
function installLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      length: 0,
      clear() {},
      getItem() {
        return null;
      },
      key() {
        return null;
      },
      removeItem() {},
      setItem() {},
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  };
}

/**
 * A project manager over an in-memory file system seeded with the given
 * top-level extensions map, as a project saved before graduation. `appData`
 * carries the project's persisted store (installed-extension snapshots, brains);
 * passing a shared map across two managers mirrors two loads of the same saved
 * project. `updateActive` merges the applied extensions map, mirroring the
 * install transaction's manifest write.
 */
function seededProjectManager(
  extensions: Record<string, string>,
  filesystem: ProjectFileSystem,
  appData: Map<string, string> = new Map()
): ProjectManager {
  let activeProject: ActiveProject = {
    manifest: {
      id: "p1",
      projectCollectionId: "c1",
      name: "p1",
      version: "0.1.0",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      extensions,
    },
    filesystem,
  } as ActiveProject;
  return {
    get activeProject(): ActiveProject {
      return activeProject;
    },
    activeProjectCollection: { projectCollectionId: "c1", name: "c", createdAt: 1, updatedAt: 1 },
    async init(): Promise<void> {},
    async getProjectCollectionState(): Promise<{ access: "ready" }> {
      return { access: "ready" };
    },
    async ensureDefaultProject(): Promise<void> {},
    async updateActive(updates: { extensions?: Record<string, string> }): Promise<void> {
      activeProject = { manifest: { ...activeProject.manifest, ...updates }, filesystem } as ActiveProject;
    },
    async saveAppData(key: string, data: string): Promise<void> {
      appData.set(key, data);
    },
    async loadAppData(key: string): Promise<string | undefined> {
      return appData.get(key);
    },
    async deleteAppData(key: string): Promise<void> {
      appData.delete(key);
    },
    dispose(): void {},
  } as unknown as ProjectManager;
}

/** A Position fetch fixture transport that counts its `fetchFile` calls, so a test can assert a load did or did not fetch. */
function countingTransport(): {
  transport: ReturnType<typeof createCodalPositionFixtureTransport>;
  fetchCount: () => number;
} {
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

/** The app's host over the seeded project, wired with the catalog moves and a given Position fetch transport. */
function makeHost(
  projectManager: ProjectManager,
  transport = createCodalPositionFixtureTransport()
): AppEnvironmentHost {
  const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
  return new AppEnvironmentHost({
    projectManager,
    modules: [coreModule(), createWodalSharedModule(), profile.createMindcraftModule()],
    numerics: createProfileNumerics(profile.numberPrecision),
    mounts: [],
    embeddedExtensions: embedRecordWithoutPosition(),
    catalogMoves: microbitLibraryCatalogMoves,
    extensionFetchTransport: transport,
  });
}

describe("Position graduation -- saved-project migration (top-level)", () => {
  test("a top-level embedded Position reference migrates to the gh: ref on load and still resolves", async () => {
    const restore = installLocalStorage();
    const host = makeHost(
      seededProjectManager(
        { ...microbitDefaultExtensions, [CODAL_POSITION_EXT_COORDINATE]: `embedded:${CODAL_POSITION_EXT_COORDINATE}` },
        createInMemoryProjectFileSystem()
      )
    );
    try {
      await host.initialize("p1");

      const extensions = host.activeProjectManifest?.extensions ?? {};
      assert.equal(
        extensions[CODAL_POSITION_EXT_COORDINATE],
        CODAL_POSITION_GH_REF,
        "the load-time move rewrite replaced the embedded reference with the gh: reference"
      );

      const migratedResolved = resolveProjectExtensions(extensions, sourcesWithMove());
      assert.ok(
        migratedResolved.origins.find((entry) => entry.origin === CODAL_POSITION_EXT_COORDINATE),
        "the migrated project resolves Position through the gh: ref"
      );
    } finally {
      host.dispose();
      restore();
    }
  });
});

describe("Position graduation -- transitive dependency self-heals on load", () => {
  for (const dependent of [CUTEBOT_EXT_COORDINATE, YAHBOOM_GAMEPAD_EXT_COORDINATE]) {
    test(`a project with ${dependent} installed before graduation fetches and resolves Position on a plain load`, async () => {
      const restore = installLocalStorage();
      // Seeded exactly as a project saved while Position was still bundled: the
      // dependent is a top-level embedded ref, Position is only its transitive
      // dep, and no Position snapshot was ever persisted.
      const { transport, fetchCount } = countingTransport();
      const host = makeHost(
        seededProjectManager(
          { ...microbitDefaultExtensions, [dependent]: `embedded:${dependent}` },
          createInMemoryProjectFileSystem()
        ),
        transport
      );
      try {
        // Plain load: initialize only, no install transaction.
        await host.initialize("p1");

        assert.ok(fetchCount() > 0, "the load fetched the moved Position content through the transport");

        // The fetched Position snapshot persisted under its gh: reference.
        const metadata = host.getInstalledExtensionMetadata();
        assert.equal(
          metadata[CODAL_POSITION_EXT_COORDINATE]?.reference,
          CODAL_POSITION_GH_REF,
          "Position persisted under the pinned gh: reference the move names"
        );

        // Position resolved into the closure the app reads.
        const installed = host.installedLibraries.map((library) => library.coordinate);
        assert.ok(installed.includes(CODAL_POSITION_EXT_COORDINATE), "Position resolved into the installed closure");
      } finally {
        host.dispose();
        restore();
      }
    });
  }

  test("a second load of an already-healed project does not refetch the moved content", async () => {
    const restore = installLocalStorage();
    const store = new Map<string, string>();
    const extensions = { ...microbitDefaultExtensions, [CUTEBOT_EXT_COORDINATE]: `embedded:${CUTEBOT_EXT_COORDINATE}` };

    const first = countingTransport();
    const firstHost = makeHost(
      seededProjectManager(extensions, createInMemoryProjectFileSystem(), store),
      first.transport
    );
    try {
      await firstHost.initialize("p1");
      assert.ok(first.fetchCount() > 0, "the first load heals by fetching the moved content");
    } finally {
      firstHost.dispose();
    }

    // Second load over the SAME persisted store: the Position snapshot is now
    // present, so the load is a cache hit and no fetch runs.
    const second = countingTransport();
    const secondHost = makeHost(
      seededProjectManager(extensions, createInMemoryProjectFileSystem(), store),
      second.transport
    );
    try {
      await secondHost.initialize("p1");
      assert.equal(second.fetchCount(), 0, "the already-persisted moved content is not refetched");
      const installed = secondHost.installedLibraries.map((library) => library.coordinate);
      assert.ok(installed.includes(CODAL_POSITION_EXT_COORDINATE), "Position still resolves from the cached snapshot");
    } finally {
      secondHost.dispose();
      restore();
    }
  });
});
