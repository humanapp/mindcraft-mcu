import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createIdbProjectStore, importProjectDocument, ProjectManager } from "@mindcraft-lang/app-host";
import { AppEnvironmentHost } from "@mindcraft-lang/bridge-app";
import { BrainDef, coreModule } from "@mindcraft-lang/core/app";
import { createProfileNumerics } from "@mindcraft-lang/core/runtime";
import { type AmbientFile, buildCompiledActionBundle, UserTileProject } from "@mindcraft-lang/ts-compiler";
import {
  buildWodalProgramImage,
  createWodalSharedModule,
  getWodalDeviceProfile,
  validateWodalTarget,
  WodalDeviceProfileId,
} from "@mindcraft-lang/wodal";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { name as appName, version as appVersion } from "../../package.json";
import {
  BRAINS_INDEX_KEY,
  buildMicrobitSimExportDocument,
  parseMicrobitSimTarget,
  SIMULATOR_STATE_KEY,
} from "./project-io";

// The app-host reads localStorage for app-side caches; provide an in-memory shim so the host runs headlessly.
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

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** The microbit-v2 compiler surface, read from disk (the app's `?raw` imports are Vite-only). */
function microbitAmbientFiles(): readonly AmbientFile[] {
  return [
    {
      path: "mindcraft.core.d.ts",
      content: readText("../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
    },
    {
      path: "mindcraft.microbit-v2.d.ts",
      content: readText("../../../../packages/wodal/ambient/mindcraft.microbit-v2.d.ts"),
    },
  ];
}

const SENSOR_SOURCE = `import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "button-a-pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
`;

const ACTUATOR_SOURCE = `import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "set-display-pixel",
  onExecute(ctx: Context): void {
    ctx.microbit.display.setPixelValue(0, 0, 255);
  },
});
`;

describe("user-tile bytecode in microbit-v2 program images", () => {
  it("links user-tile bytecode into the program when a brain uses the tiles", () => {
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const environment = createMicroBitV2Environment();

    const project = new UserTileProject({ ambientFiles: microbitAmbientFiles(), services: environment.brainServices });
    project.setFiles(
      new Map([
        ["button-a-pressed.ts", SENSOR_SOURCE],
        ["set-display-pixel.ts", ACTUATOR_SOURCE],
      ])
    );
    const compileResult = project.compileAll();
    assert.equal(
      compileResult.tsErrors.size,
      0,
      `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
    );
    const bundle = buildCompiledActionBundle(compileResult, { services: environment.brainServices });
    assert.ok(bundle, "expected a compiled action bundle");
    environment.replaceActionBundle(bundle);

    const sensorTile = bundle.tiles.find((tile) => tile.kind === "sensor");
    const actuatorTile = bundle.tiles.find((tile) => tile.kind === "actuator");
    assert.ok(sensorTile);
    assert.ok(actuatorTile);

    const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "uses user tiles");
    const rule = brainDef.pages().get(0)!.children().get(0)!;
    rule.when().appendTile(sensorTile);
    rule.do().appendTile(actuatorTile);

    const built = buildWodalProgramImage({ brainDef, environment, deviceProfile: profile });
    if (!built.ok) {
      assert.fail(`build failed: ${JSON.stringify(built.errors)}`);
    }

    const actions = built.image.program.program.actions;
    assert.ok(actions, "expected the linked program to carry bytecode actions");
    assert.equal(actions.size(), 2);
    for (let i = 0; i < actions.size(); i++) {
      assert.equal(actions.get(i)!.binding, "bytecode");
    }
  });

  it("produces no bytecode actions for a brain that uses no user tiles", () => {
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const environment = createMicroBitV2Environment();
    const brainDef = BrainDef.emptyBrainDef(environment.brainServices, "no user tiles");

    const built = buildWodalProgramImage({ brainDef, environment, deviceProfile: profile });
    if (!built.ok) {
      assert.fail(`build failed: ${JSON.stringify(built.errors)}`);
    }

    const actions = built.image.program.program.actions;
    assert.ok(!actions || actions.size() === 0);
  });
});

describe("user-tile source round-trips through .mindcraft", () => {
  it("preserves the tile source across export and re-import", async () => {
    const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const host = new AppEnvironmentHost({
      projectManager: new ProjectManager(await createIdbProjectStore(`user-tile-export-${storeCounter++}`)),
      modules: [coreModule(), createWodalSharedModule(), profile.createMindcraftModule()],
      numerics: createProfileNumerics(profile.numberPrecision),
      ambientFiles: [],
      host: { name: appName, version: appVersion },
    });
    await host.initialize("Tile Project");

    const tilePath = "tiles/my-sensor.ts";
    host.projectFileSystem.applyLocalChange({
      action: "write",
      path: tilePath,
      content: SENSOR_SOURCE,
      newEtag: "etag-1",
    });

    const document = await buildMicrobitSimExportDocument(host.projectManager, profile.profileId, {
      brainOrder: [],
      simulator: undefined,
    });
    host.dispose();

    const parsed = JSON.parse(document) as { files: Array<{ path: string; content: string }> };
    const exported = parsed.files.find((file) => file.path === tilePath);
    assert.ok(exported, "exported document should include the user-tile source");
    assert.equal(exported.content, SENSOR_SOURCE);

    const importStore = await createIdbProjectStore(`user-tile-import-${storeCounter++}`);
    const importPm = new ProjectManager(importStore);
    await importPm.init();
    const file = new File([document], "tile-project.mindcraft");
    const result = await importProjectDocument(file, appName, appVersion, importPm, {
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
    const files = await importStore.loadProjectFiles(result.projectId!);
    const entry = files?.get(tilePath);
    assert.ok(entry && entry.kind === "file", "re-imported project should contain the user-tile source");
    assert.equal(entry.content, SENSOR_SOURCE);
  });
});
