/**
 * End-to-end reconcile through the app host: an edit that removes a user tile
 * from the TypeScript project removes it from the brain editor's offering on the
 * next compile, and an edit that leaves the tile's source blocked mid-edit keeps
 * the offering it last compiled. Each case drives the real file-change entry
 * point the folder session calls and reads the real suggestion oracle.
 */

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
} from "@wendoo-lang/app-host";
import type { AppEnvironmentHostOptions } from "@wendoo-lang/bridge-app";
import { AppEnvironmentHost } from "@wendoo-lang/bridge-app";
import { List } from "@wendoo-lang/core";
import { coreModule, mkActuatorTileId } from "@wendoo-lang/core/app";
import { type IBrainTileDef, type ITileCatalog, RuleSide } from "@wendoo-lang/core/brain";
import {
  type InsertionContext,
  parseTilesForSuggestions,
  suggestTiles,
} from "@wendoo-lang/core/brain/language-service";
import { declarationMount, isCompilerControlledPath, type Mount } from "@wendoo-lang/ts-compiler";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const CORE_AMBIENT = readText("../../../../external/wendoo-lang/packages/core/lib/wendoo.core.d.ts");
const MOUNTS: readonly Mount[] = [declarationMount([{ path: "wendoo.core.d.ts", content: CORE_AMBIENT }])];

const PROJECT_ID = "mb-p1";

const MY_ACTUATOR = `import { Actuator, type Context } from "wendoo";

export default Actuator({
  id: "acmine0000000001",
  name: "my actuator",
  onExecute(ctx: Context): void {
  },
});
`;

const KEEP_ACTUATOR = `import { Actuator, type Context } from "wendoo";

export default Actuator({
  id: "ackeep0000000001",
  name: "keep actuator",
  onExecute(ctx: Context): void {
  },
});
`;

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

function stubProjectManager(filesystem: ProjectFileSystem): ProjectManager {
  const collection: ProjectCollection = {
    projectCollectionId: "collection-1",
    name: "Collection",
    createdAt: 1,
    updatedAt: 1,
  };
  const appData = new Map<string, string>();
  const activeProject: ActiveProject = {
    manifest: {
      id: PROJECT_ID,
      projectCollectionId: "collection-1",
      name: PROJECT_ID,
      version: "0.1.0",
      description: "",
      createdAt: 1,
      updatedAt: 1,
      extensions: {},
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
    async updateActive(): Promise<void> {},
    async saveAppData(key: string, value: string): Promise<void> {
      appData.set(key, value);
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

function createHost(onDidCompile?: AppEnvironmentHostOptions["onDidCompile"]): AppEnvironmentHost {
  const filesystem = createInMemoryProjectFileSystem({
    shouldExclude: (path) => isCompilerControlledPath(path, MOUNTS),
  });
  return new AppEnvironmentHost({
    projectManager: stubProjectManager(filesystem),
    modules: [coreModule()],
    mounts: MOUNTS,
    ...(onDidCompile ? { onDidCompile } : {}),
  });
}

/** Tile ids the suggestion oracle offers for an empty DO side, over the environment's live catalog chain. */
function offeredDoSideTileIds(host: AppEnvironmentHost): Set<string> {
  const context: InsertionContext = {
    ruleSide: RuleSide.Do,
    expr: parseTilesForSuggestions(List.empty<IBrainTileDef>()),
  };
  const catalogs = List.from<ITileCatalog>([...host.env.tileCatalogs()]);
  const result = suggestTiles(context, catalogs, host.env.brainServices);
  const ids = new Set<string>();
  for (let i = 0; i < result.exact.size(); i++) ids.add(result.exact.get(i).tileDef.tileId);
  for (let i = 0; i < result.withConversion.size(); i++) ids.add(result.withConversion.get(i).tileDef.tileId);
  return ids;
}

const MINE_ACTION_KEY = `${PROJECT_ID}:user.actuator.acmine0000000001`;
const MINE_TILE_ID = mkActuatorTileId(MINE_ACTION_KEY);
const KEEP_TILE_ID = mkActuatorTileId(`${PROJECT_ID}:user.actuator.ackeep0000000001`);

describe("user tile catalog reconcile on recompile", () => {
  test("an actuator file deleted from the project stops being offered", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const host = createHost();
    try {
      await host.initialize(PROJECT_ID);

      host.applyExternalProjectFileChange({ action: "write", path: "keep.ts", content: KEEP_ACTUATOR, newEtag: "e1" });
      host.applyExternalProjectFileChange({ action: "write", path: "mine.ts", content: MY_ACTUATOR, newEtag: "e2" });

      assert.ok(offeredDoSideTileIds(host).has(MINE_TILE_ID), "the added actuator is offered");

      host.applyExternalProjectFileChange({ action: "delete", path: "mine.ts" });

      const after = offeredDoSideTileIds(host);
      assert.ok(after.has(KEEP_TILE_ID), "the surviving actuator is still offered");
      assert.equal(after.has(MINE_TILE_ID), false, "the deleted actuator is no longer offered");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("the last actuator deleted while a non-tile file fails to typecheck stops being offered", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const host = createHost();
    try {
      await host.initialize(PROJECT_ID);

      host.applyExternalProjectFileChange({ action: "write", path: "mine.ts", content: MY_ACTUATOR, newEtag: "e1" });
      assert.ok(offeredDoSideTileIds(host).has(MINE_TILE_ID), "the added actuator is offered");

      host.applyExternalProjectFileChange({
        action: "write",
        path: "helper.ts",
        content: 'export const value: number = "not a number";\n',
        newEtag: "e2",
      });
      host.applyExternalProjectFileChange({ action: "delete", path: "mine.ts" });

      assert.equal(offeredDoSideTileIds(host).has(MINE_TILE_ID), false, "the deleted actuator is no longer offered");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("an actuator whose sole source file is mid-edit and unextractable keeps being offered", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const host = createHost();
    try {
      await host.initialize(PROJECT_ID);

      host.applyExternalProjectFileChange({ action: "write", path: "mine.ts", content: MY_ACTUATOR, newEtag: "e1" });
      assert.ok(offeredDoSideTileIds(host).has(MINE_TILE_ID), "the added actuator is offered");

      host.applyExternalProjectFileChange({
        action: "write",
        path: "mine.ts",
        content: 'import { Actuator, type Context } from "wendoo";\n\nexport default Actu\n',
        newEtag: "e2",
      });

      assert.ok(offeredDoSideTileIds(host).has(MINE_TILE_ID), "the mid-edit tile keeps its last good offering");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("an actuator whose whole tile folder is deleted stops being offered", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const host = createHost();
    try {
      await host.initialize(PROJECT_ID);

      host.applyExternalProjectFileChange({ action: "write", path: "keep.ts", content: KEEP_ACTUATOR, newEtag: "e1" });
      host.applyExternalProjectFileChange({
        action: "write",
        path: "my-actuator/my-actuator.ts",
        content: MY_ACTUATOR,
        newEtag: "e2",
      });

      assert.ok(offeredDoSideTileIds(host).has(MINE_TILE_ID), "the added actuator is offered");

      // Removing a scaffolded tile removes its folder; the host reports the
      // folder path, never the source file under it.
      host.applyExternalProjectFileChange({ action: "delete", path: "my-actuator" });

      const after = offeredDoSideTileIds(host);
      assert.ok(after.has(KEEP_TILE_ID), "the surviving actuator is still offered");
      assert.equal(after.has(MINE_TILE_ID), false, "the deleted folder's actuator is no longer offered");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("the recompile after a tile folder is deleted notifies listeners with the tile already gone", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const compiles: Array<{ changedActionKeys: readonly string[]; metadataKeys: readonly string[] }> = [];
    const host = createHost((_result, tileResult) => {
      compiles.push({
        changedActionKeys: [...(tileResult?.changedActionKeys ?? [])],
        // Read the live catalog from inside the notification: a listener woken
        // by this signal must already see the reconciled offering.
        metadataKeys: [...offeredDoSideTileIds(host)],
      });
    });
    try {
      await host.initialize(PROJECT_ID);

      host.applyExternalProjectFileChange({
        action: "write",
        path: "my-actuator/my-actuator.ts",
        content: MY_ACTUATOR,
        newEtag: "e1",
      });
      const revisionAfterAdd = host.docRevision;
      compiles.length = 0;

      host.applyExternalProjectFileChange({ action: "delete", path: "my-actuator" });

      assert.equal(compiles.length, 1, "the delete recompile notifies the compile listener once");
      assert.ok(
        compiles[0]?.changedActionKeys.includes(MINE_ACTION_KEY),
        "the notification names the removed action key"
      );
      assert.equal(
        compiles[0]?.metadataKeys.includes(MINE_TILE_ID),
        false,
        "the offering read from inside the notification no longer holds the removed tile"
      );
      assert.ok(
        host.docRevision > revisionAfterAdd,
        "the delete recompile advances the doc revision the editor config subscribes to"
      );
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });

  test("an actuator declaration removed from a surviving file stops being offered", async () => {
    const restoreLocalStorage = installEmptyLocalStorage();
    const host = createHost();
    try {
      await host.initialize(PROJECT_ID);

      host.applyExternalProjectFileChange({ action: "write", path: "keep.ts", content: KEEP_ACTUATOR, newEtag: "e1" });
      host.applyExternalProjectFileChange({ action: "write", path: "mine.ts", content: MY_ACTUATOR, newEtag: "e2" });

      assert.ok(offeredDoSideTileIds(host).has(MINE_TILE_ID), "the added actuator is offered");

      host.applyExternalProjectFileChange({ action: "write", path: "mine.ts", content: "export {};\n", newEtag: "e3" });

      const after = offeredDoSideTileIds(host);
      assert.ok(after.has(KEEP_TILE_ID), "the surviving actuator is still offered");
      assert.equal(after.has(MINE_TILE_ID), false, "the removed actuator is no longer offered");
    } finally {
      host.dispose();
      restoreLocalStorage();
    }
  });
});
