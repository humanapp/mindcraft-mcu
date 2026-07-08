import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { EmbeddedExtension, ExtensionCatalogEntry } from "@mindcraft-lang/bridge-app";
import { ExtensionActionResultCode } from "@mindcraft-lang/bridge-app";
import {
  buildMicrobitExtensionEntries,
  type ExtensionProjectPersistence,
  githubDocsUrl,
  installMicrobitExtension,
  toExtensionBrowserEntry,
  uninstallMicrobitExtension,
} from "./microbit-extension-browser";
import {
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  WODAL_LIB_COORDINATE,
} from "./microbit-extension-coordinates";

/** Build an embedded extension whose bundled `mindcraft.json` declares the given manifest fields. */
function ext(
  coordinate: string,
  manifest: {
    name?: string;
    version?: string;
    extensions?: Record<string, string>;
    targets?: Record<string, { packageVersion: string }>;
    thumbnailUrl?: string;
  }
): EmbeddedExtension {
  return {
    canonicalOrigin: coordinate,
    files: [
      { path: "index.ts", content: "export {};" },
      {
        path: "mindcraft.json",
        content: JSON.stringify({
          name: manifest.name ?? coordinate,
          version: manifest.version ?? "1.0.0",
          ...(manifest.thumbnailUrl !== undefined ? { thumbnailUrl: manifest.thumbnailUrl } : {}),
          ...(manifest.extensions !== undefined ? { extensions: manifest.extensions } : {}),
          ...(manifest.targets !== undefined ? { targets: manifest.targets } : {}),
        }),
      },
    ],
  };
}

const POSITION = "mindcraft-lang/microbit-position";
const LEGACY = "mindcraft-lang/legacy-widget";

const coreLib = ext(CORE_LIB_COORDINATE, { name: "Core", version: "0.2.1" });
const wodalLib = ext(WODAL_LIB_COORDINATE, {
  name: "Wodal",
  version: "0.2.1",
  extensions: { [CORE_LIB_COORDINATE]: `embedded:${CORE_LIB_COORDINATE}` },
});
const microbitLib = ext(MICROBIT_V2_LIB_COORDINATE, {
  name: "Micro:bit v2",
  version: "0.2.1",
  extensions: { [WODAL_LIB_COORDINATE]: `embedded:${WODAL_LIB_COORDINATE}` },
});
/** A micro:bit-compatible add-on carrying a thumbnail. */
const positionAddon = ext(POSITION, {
  name: "Position",
  version: "1.3.0",
  thumbnailUrl: "data:,pos",
  targets: { [MICROBIT_V2_LIB_COORDINATE]: { packageVersion: "^0.2.0" } },
});
/** An add-on whose micro:bit target is at a version the stack excludes. */
const legacyAddon = ext(LEGACY, {
  name: "Legacy Widget",
  version: "1.0.0",
  targets: { [MICROBIT_V2_LIB_COORDINATE]: { packageVersion: "^0.1.0" } },
});

const embedRecord: readonly EmbeddedExtension[] = [microbitLib, wodalLib, coreLib, positionAddon, legacyAddon];
const project = { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE };

/** A persistence double capturing every extensions map applied through the host. */
function capturingPersistence(): ExtensionProjectPersistence & { patches: Array<Record<string, string> | undefined> } {
  const patches: Array<Record<string, string> | undefined> = [];
  return {
    patches,
    updateProjectExtensions: async (extensions) => {
      patches.push(extensions);
    },
  };
}

describe("buildMicrobitExtensionEntries -- catalog build and adaptation", () => {
  test("lists the locked micro:bit layer and the compatible add-on, each with a derived docs URL", () => {
    const entries = buildMicrobitExtensionEntries(project, embedRecord);
    assert.deepEqual(entries.map((e) => e.coordinate).sort(), [MICROBIT_V2_LIB_COORDINATE, POSITION].sort());

    const microbit = entries.find((e) => e.coordinate === MICROBIT_V2_LIB_COORDINATE);
    assert.ok(microbit);
    assert.equal(microbit.locked, true);
    assert.equal(microbit.installed, true);
    assert.equal(microbit.docsUrl, `https://github.com/${MICROBIT_V2_LIB_COORDINATE}`);

    const position = entries.find((e) => e.coordinate === POSITION);
    assert.ok(position);
    assert.equal(position.locked, false);
    assert.equal(position.installed, false);
    assert.equal(position.name, "Position");
    assert.equal(position.thumbnailUrl, "data:,pos");
    assert.equal(position.docsUrl, `https://github.com/${POSITION}`);
  });

  test("excludes transitive layer libs and a version-incompatible add-on", () => {
    const entries = buildMicrobitExtensionEntries(project, embedRecord);
    const coordinates = entries.map((e) => e.coordinate);
    assert.equal(coordinates.includes(CORE_LIB_COORDINATE), false);
    assert.equal(coordinates.includes(WODAL_LIB_COORDINATE), false);
    assert.equal(coordinates.includes(LEGACY), false);
  });
});

describe("toExtensionBrowserEntry", () => {
  test("derives the docs URL and passes through a declared thumbnail", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: POSITION,
      name: "Position",
      version: "1.3.0",
      thumbnailUrl: "data:,pos",
      installed: false,
      locked: false,
    };
    assert.deepEqual(toExtensionBrowserEntry(catalogEntry), {
      coordinate: POSITION,
      name: "Position",
      version: "1.3.0",
      thumbnailUrl: "data:,pos",
      installed: false,
      locked: false,
      docsUrl: `https://github.com/${POSITION}`,
    });
  });

  test("omits the thumbnail when the catalog entry declares none", () => {
    const catalogEntry: ExtensionCatalogEntry = {
      coordinate: MICROBIT_V2_LIB_COORDINATE,
      name: "Micro:bit v2",
      version: "0.2.1",
      installed: true,
      locked: true,
    };
    assert.equal("thumbnailUrl" in toExtensionBrowserEntry(catalogEntry), false);
  });

  test("githubDocsUrl builds the repository URL", () => {
    assert.equal(githubDocsUrl(POSITION), "https://github.com/mindcraft-lang/microbit-position");
  });
});

describe("installMicrobitExtension -- round-trips through the host", () => {
  test("installing an add-on persists an extensions map that gains the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await installMicrobitExtension(persistence, project, POSITION, embedRecord);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.INSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(persistence.patches[0]?.[POSITION], `embedded:${POSITION}`);
    assert.equal(persistence.patches[0]?.[MICROBIT_V2_LIB_COORDINATE], MICROBIT_V2_LIB_REFERENCE);
  });

  test("installing an already-present coordinate does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await installMicrobitExtension(persistence, project, MICROBIT_V2_LIB_COORDINATE, embedRecord);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.ALREADY_INSTALLED);
    assert.equal(persistence.patches.length, 0);
  });
});

describe("uninstallMicrobitExtension -- round-trips through the host", () => {
  const withPosition = { ...project, [POSITION]: `embedded:${POSITION}` };

  test("uninstalling an add-on persists an extensions map that loses the coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallMicrobitExtension(persistence, withPosition, POSITION);
    assert.equal(result.ok, true);
    assert.equal(result.code, ExtensionActionResultCode.UNINSTALLED);
    assert.equal(persistence.patches.length, 1);
    assert.equal(POSITION in (persistence.patches[0] ?? {}), false);
    assert.equal(persistence.patches[0]?.[MICROBIT_V2_LIB_COORDINATE], MICROBIT_V2_LIB_REFERENCE);
  });

  test("uninstalling a locked layer library is rejected and does not persist", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallMicrobitExtension(persistence, project, MICROBIT_V2_LIB_COORDINATE);
    assert.equal(result.ok, false);
    assert.equal(result.code, ExtensionActionResultCode.LOCKED);
    assert.equal(persistence.patches.length, 0);
  });
});
