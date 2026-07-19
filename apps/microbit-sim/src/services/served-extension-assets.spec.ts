import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ActiveProject,
  createInMemoryProjectFileSystem,
  type ProjectCollection,
  type ProjectFileSystem,
  type ProjectManager,
} from "@mindcraft-lang/app-host";
import { AppEnvironmentHost, createVfsAssetUrlProvider, type EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { coreModule, mkActuatorTileId, mkSensorTileId } from "@mindcraft-lang/core/app";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { declarationMount, isCompilerControlledPath, type Mount } from "@mindcraft-lang/ts-compiler";
import { buildMicrobitBrainEditorConfig } from "../brain/editor-config";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const CORE_AMBIENT = readText("../../../../external/mindcraft-lang/packages/core/lib/mindcraft.core.d.ts");

const BEAM_COORDINATE = "mindcraft-lang/beam-lib";
const BEAM_REFERENCE = `embedded:${BEAM_COORDINATE}`;
const BEAM_ICON_PATH = `.libraries/${BEAM_COORDINATE}/beam.svg`;
const BEAM_ICON_SVG = '<svg id="beam"></svg>';

const BEAM_EXTENSION_ENTRY = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  id: "beamSensor000001",
  name: "beam",
  icon: "./beam.svg",
  onExecute(ctx: Context): number {
    return 1;
  },
});
`;

const BEAM_EXTENSION: EmbeddedExtension = {
  canonicalOrigin: BEAM_COORDINATE,
  files: [
    { path: "beam.ts", content: BEAM_EXTENSION_ENTRY },
    { path: "beam.svg", content: BEAM_ICON_SVG },
    { path: "mindcraft.json", content: JSON.stringify({ name: "Beam", version: "0.1.0", entry: "beam.ts" }) },
  ],
};

const MOUNTS: readonly Mount[] = [declarationMount([{ path: "mindcraft.core.d.ts", content: CORE_AMBIENT }])];

function installEmptyLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage: Storage = {
    get length(): number {
      return 0;
    },
    clear(): void {},
    getItem(): string | null {
      return null;
    },
    key(): string | null {
      return null;
    },
    removeItem(): void {},
    setItem(): void {},
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
      return;
    }
    Reflect.deleteProperty(globalThis, "localStorage");
  };
}

function stubProjectManager(filesystem: ProjectFileSystem, initialExtensions: Record<string, string>): ProjectManager {
  const collection: ProjectCollection = {
    projectCollectionId: "collection-1",
    name: "Collection",
    createdAt: 1,
    updatedAt: 1,
  };
  let activeProject: ActiveProject = {
    manifest: {
      id: "mb-p1",
      projectCollectionId: "collection-1",
      name: "mb-p1",
      version: "0.1.0",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      extensions: initialExtensions,
    },
    filesystem,
  } as ActiveProject;
  return {
    get activeProject(): ActiveProject {
      return activeProject;
    },
    activeProjectCollection: collection,
    async init(): Promise<void> {},
    async getProjectCollectionState(): Promise<{ access: "ready" }> {
      return { access: "ready" };
    },
    async ensureDefaultProject(): Promise<void> {},
    async updateActive(updates: { extensions?: Record<string, string> }): Promise<void> {
      activeProject = {
        manifest: { ...activeProject.manifest, ...updates },
        filesystem: activeProject.filesystem,
      } as ActiveProject;
    },
    async saveAppData(): Promise<void> {},
    async loadAppData(): Promise<string | undefined> {
      return undefined;
    },
    async deleteAppData(): Promise<void> {},
    dispose(): void {},
  } as unknown as ProjectManager;
}

describe("microbit-sim served extension assets", () => {
  test("the served file system serves an installed extension's tile icon; the raw project fs does not", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, MOUNTS),
    });
    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem, {}),
      modules: [coreModule()],
      mounts: MOUNTS,
      embeddedExtensions: [BEAM_EXTENSION],
    });

    try {
      await host.initialize("mb-p1");
      await host.updateProjectExtensions({ [BEAM_COORDINATE]: BEAM_REFERENCE });

      const served = host.servedProjectFileSystem.exportSnapshot().get(BEAM_ICON_PATH);
      assert.ok(served && served.kind === "file", `the served snapshot carries ${BEAM_ICON_PATH}`);
      assert.equal(served.content, BEAM_ICON_SVG);

      assert.equal(
        host.projectFileSystem.exportSnapshot().get(BEAM_ICON_PATH),
        undefined,
        "the raw project fs does not carry the compiler-controlled extension icon"
      );
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("the beam tile's icon resolves through the editor config's resolveTileVisual, re-minting per VFS revision", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const filesystem = createInMemoryProjectFileSystem({
      shouldExclude: (path) => isCompilerControlledPath(path, MOUNTS),
    });
    const host = new AppEnvironmentHost({
      projectManager: stubProjectManager(filesystem, {}),
      modules: [coreModule()],
      mounts: MOUNTS,
      embeddedExtensions: [BEAM_EXTENSION],
    });

    try {
      await host.initialize("mb-p1");
      await host.updateProjectExtensions({ [BEAM_COORDINATE]: BEAM_REFERENCE });

      // The same provider-over-store shape the app wires: served snapshot as
      // content source, host VFS revision as the re-mint trigger.
      const provider = createVfsAssetUrlProvider({
        getProjectFileSystem: () => host.servedProjectFileSystem,
        getVfsRevision: host.getVfsRevisionSnapshot,
      });
      const config = buildMicrobitBrainEditorConfig(
        host.env,
        (url) => provider.resolveAssetUrl(url),
        host.activeProjectManifest?.id
      );
      assert.ok(config.resolveTileVisual, "the editor config carries a tile visual resolver");

      const beamMeta = host.lastUserTileMetadata?.find((m) => m.namespace === BEAM_COORDINATE);
      assert.ok(beamMeta, "the installed beam tile registers user-tile metadata");
      const tileId = beamMeta.kind === "sensor" ? mkSensorTileId(beamMeta.key) : mkActuatorTileId(beamMeta.key);
      let tileDef: IBrainTileDef | undefined;
      for (const catalog of host.env.tileCatalogs()) {
        tileDef ??= catalog.get(tileId);
      }
      assert.ok(tileDef, "the beam tile is registered in a tile catalog");

      const mintedIconUrl = config.resolveTileVisual(tileDef)?.iconUrl ?? "";
      assert.ok(mintedIconUrl.startsWith("blob:"), "the compiled /vfs/ icon URL resolves to an object URL");
      const blob = resolveObjectURL(mintedIconUrl);
      assert.ok(blob, "the resolved object URL is loadable");
      assert.equal(await blob.text(), BEAM_ICON_SVG, "the resolved URL carries the bundled icon bytes");

      // A revision bump re-mints and revokes the superseded generation.
      host.bumpVfsRevision();
      const fresh = config.resolveTileVisual(tileDef)?.iconUrl;
      assert.ok(fresh, "the tile icon still resolves after the bump");
      assert.notEqual(fresh, mintedIconUrl, "the new generation mints a new URL");
      assert.equal(resolveObjectURL(mintedIconUrl), undefined, "the superseded URL is revoked");
      assert.equal(await resolveObjectURL(fresh)?.text(), BEAM_ICON_SVG, "the fresh URL carries the icon bytes");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
