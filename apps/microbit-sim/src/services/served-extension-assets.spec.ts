import assert from "node:assert/strict";
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
import { AppEnvironmentHost, type EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { coreModule } from "@mindcraft-lang/core/app";
import { declarationMount, isCompilerControlledPath, type Mount } from "@mindcraft-lang/ts-compiler";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const CORE_AMBIENT = readText("../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts");

const BEAM_COORDINATE = "mindcraft-lang/beam-lib";
const BEAM_REFERENCE = `embedded:${BEAM_COORDINATE}`;
const BEAM_ICON_PATH = `.extensions/${BEAM_COORDINATE}/beam.svg`;
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

describe("microbit-sim service worker served extension assets", () => {
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
});
