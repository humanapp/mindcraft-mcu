import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CATALOG_ENTRY_KIND_EXTENSION, validateExtensionCatalogDocument } from "@mindcraft-lang/app-host";
import type { EmbeddedExtension, FetchedExtensionContentMap } from "@mindcraft-lang/bridge-app";
import { ExtensionActionResultCode } from "@mindcraft-lang/bridge-app";
import {
  buildMicrobitCatalogOffers,
  buildMicrobitExtensionEntries,
  type ExtensionProjectPersistence,
  loadMicrobitLibraryCatalog,
  uninstallMicrobitExtension,
} from "./microbit-extension-browser";
import {
  CODAL_LIB_COORDINATE,
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  MICROBIT_V2_TARGET_COORDINATE,
  MICROBIT_V2_TARGET_REFERENCE,
} from "./microbit-extension-coordinates";
import microbitLibraryCatalogDocument from "./microbit-library-catalog.json";

const CUTEBOT = "mindcraft-lang/lib-microbit-cutebot";
const YAHBOOM = "mindcraft-lang/lib-microbit-yahboom-gamepad";
const POSITION = "mindcraft-lang/lib-codal-position";

/** Read a host-bundled embedded library's manifest version from its source directory. */
function bundledManifestVersion(dir: string): string {
  const url = new URL(`../../extensions/${dir}/mindcraft.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")).version;
}

describe("microbit library catalog document", () => {
  test("the seeded catalog validates with no errors and no warnings", () => {
    const result = validateExtensionCatalogDocument(microbitLibraryCatalogDocument);
    assert.ok(result.ok);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  test("every entry is a library with an embedded ref matching its coordinate and no alias", () => {
    const result = validateExtensionCatalogDocument(microbitLibraryCatalogDocument);
    assert.ok(result.ok);
    // Position is a transitive sub-dependency of the featured chassis libraries;
    // it is redirected by a move, never listed as its own entry.
    assert.deepEqual(result.document.entries.map((entry) => entry.coordinate).sort(), [CUTEBOT, YAHBOOM].sort());
    for (const entry of result.document.entries) {
      assert.equal(entry.kind, CATALOG_ENTRY_KIND_EXTENSION);
      assert.equal("alias" in entry, false);
      assert.equal(entry.ref, `embedded:${entry.coordinate}`);
    }
  });

  test("each embedded catalog entry version equals its host-bundled manifest version", () => {
    const result = validateExtensionCatalogDocument(microbitLibraryCatalogDocument);
    assert.ok(result.ok);
    const versionByCoordinate = new Map(result.document.entries.map((entry) => [entry.coordinate, entry.version]));
    assert.equal(versionByCoordinate.get(CUTEBOT), bundledManifestVersion("lib-microbit-cutebot"));
    assert.equal(versionByCoordinate.get(YAHBOOM), bundledManifestVersion("lib-microbit-yahboom-gamepad"));
  });

  test("Position graduates via a default-selector transport flip and is not listed as an entry", () => {
    const result = validateExtensionCatalogDocument(microbitLibraryCatalogDocument);
    assert.ok(result.ok);
    // The move redirects the transitive dependency's embedded ref to gh: without
    // surfacing Position as its own catalog entry.
    assert.equal(
      result.document.entries.find((entry) => entry.coordinate === POSITION),
      undefined,
      "Position is not a catalog entry"
    );
    const entries = result.document.moves[POSITION];
    assert.ok(entries, "the catalog declares a move for the Position coordinate");
    assert.equal(entries.length, 1);
    const [move] = entries;
    // A default-selector flip: no `from`, and the destination keeps the source coordinate.
    assert.equal(move.from, undefined);
    assert.match(move.ref, /^gh:mindcraft-lang\/lib-codal-position@[0-9a-f]{40}$/);
  });

  test("the startup loader throws with the stable codes when the bundled document is invalid", () => {
    assert.throws(
      () =>
        loadMicrobitLibraryCatalog({
          format: "mindcraft.catalog/1",
          entries: [],
          moves: { "example-org/moved": { ref: "not-a-reference" } },
        }),
      (thrown: unknown) => thrown instanceof Error && thrown.message.includes("CATALOG_DOCUMENT_INVALID_MOVE_REF")
    );
  });
});

describe("buildMicrobitCatalogOffers -- compatibility-filtered against the micro:bit stack", () => {
  const layer: EmbeddedExtension = {
    canonicalOrigin: MICROBIT_V2_LIB_COORDINATE,
    files: [
      { path: "index.ts", content: "export {};" },
      { path: "mindcraft.json", content: JSON.stringify({ name: "Micro:bit v2", version: "0.2.1" }) },
    ],
  };
  /** A bundled add-on targeting the micro:bit v2 layer, as the real cutebot and yahboom manifests declare. */
  function addon(coordinate: string): EmbeddedExtension {
    return {
      canonicalOrigin: coordinate,
      files: [
        { path: "index.ts", content: "export {};" },
        {
          path: "mindcraft.json",
          content: JSON.stringify({
            name: coordinate,
            version: "0.1.2",
            targets: { [MICROBIT_V2_LIB_COORDINATE]: { packageVersion: "^0.2.0" } },
          }),
        },
      ],
    };
  }
  const embedRecord: readonly EmbeddedExtension[] = [layer, addon(CUTEBOT), addon(YAHBOOM)];
  const project = { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE };

  test("the seeded cutebot and yahboom offers are compatible with a fresh micro:bit project", () => {
    const offers = buildMicrobitCatalogOffers(project, embedRecord);
    assert.deepEqual(offers.map((offer) => offer.coordinate).sort(), [CUTEBOT, YAHBOOM].sort());
    for (const offer of offers) {
      assert.equal(offer.ref, `embedded:${offer.coordinate}`);
    }
  });

  test("a project carrying an offer's coordinate drops that offer, leaving the not-installed one", () => {
    const offers = buildMicrobitCatalogOffers({ ...project, [CUTEBOT]: `embedded:${CUTEBOT}` }, embedRecord);
    assert.deepEqual(
      offers.map((offer) => offer.coordinate),
      [YAHBOOM]
    );
  });
});

describe("buildMicrobitExtensionEntries -- manifest-map membership drives gh: cards", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const TOP_LIB = "example-org/top-lib";
  const TRANSITIVE_DEP = "example-org/transitive-dep";
  const topRef = `gh:${TOP_LIB}@${SHA}`;
  const transitiveRef = `gh:${TRANSITIVE_DEP}@${SHA}`;

  const microbitLayer: EmbeddedExtension = {
    canonicalOrigin: MICROBIT_V2_LIB_COORDINATE,
    files: [
      { path: "index.ts", content: "export {};" },
      { path: "mindcraft.json", content: JSON.stringify({ name: "Micro:bit v2", version: "0.2.1" }) },
    ],
  };

  function manifestFiles(name: string): ReadonlyMap<string, string> {
    return new Map([["/mindcraft.json", JSON.stringify({ name, version: "1.0.0" })]]);
  }

  test("lists a top-level gh: install from the map and omits a transitive gh: dep held only in the snapshot store", () => {
    const extensions = { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE, [TOP_LIB]: topRef };
    // The transitive dep's content sits in the fetched-content snapshot store,
    // but its coordinate is NOT in the manifest extensions map.
    const installedContent: FetchedExtensionContentMap = new Map([
      [topRef, manifestFiles("Top Lib")],
      [transitiveRef, manifestFiles("Transitive Dep")],
    ]);
    const entries = buildMicrobitExtensionEntries(extensions, [microbitLayer], installedContent);
    const coordinates = entries.map((entry) => entry.coordinate);
    assert.equal(coordinates.includes(TOP_LIB), true);
    assert.equal(coordinates.includes(TRANSITIVE_DEP), false);
  });
});

describe("target/stdlib split -- browser representation of the seeded target and an installed catalog library", () => {
  /** Build an embedded extension whose bundled manifest declares the given dependency edges and compatibility targets. */
  function ext(
    coordinate: string,
    manifest: {
      version?: string;
      extensions?: Record<string, string>;
      targets?: Record<string, { packageVersion: string }>;
    }
  ): EmbeddedExtension {
    return {
      canonicalOrigin: coordinate,
      files: [
        { path: "index.ts", content: "export {};" },
        {
          path: "mindcraft.json",
          content: JSON.stringify({
            name: coordinate,
            version: manifest.version ?? "0.2.1",
            ...(manifest.extensions !== undefined ? { extensions: manifest.extensions } : {}),
            ...(manifest.targets !== undefined ? { targets: manifest.targets } : {}),
          }),
        },
      ],
    };
  }

  const coreLib = ext(CORE_LIB_COORDINATE, { version: "0.2.1" });
  const codalLib = ext(CODAL_LIB_COORDINATE, {
    version: "0.2.1",
    extensions: { [CORE_LIB_COORDINATE]: `embedded:${CORE_LIB_COORDINATE}` },
  });
  const microbitV2Lib = ext(MICROBIT_V2_LIB_COORDINATE, {
    version: "0.2.1",
    extensions: { [CODAL_LIB_COORDINATE]: `embedded:${CODAL_LIB_COORDINATE}` },
  });
  // The editor/hostApp target carries no stdlib code; it declares the embedded
  // edge to the stdlib layer, so the layer resolves transitively.
  const target = ext(MICROBIT_V2_TARGET_COORDINATE, {
    version: "0.2.1",
    extensions: { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
  });
  const cutebot = ext(CUTEBOT, {
    version: "0.1.2",
    targets: { [MICROBIT_V2_LIB_COORDINATE]: { packageVersion: "^0.2.0" } },
  });
  const yahboom = ext(YAHBOOM, {
    version: "0.1.2",
    targets: { [MICROBIT_V2_LIB_COORDINATE]: { packageVersion: "^0.2.0" } },
  });

  const embedRecord: readonly EmbeddedExtension[] = [target, microbitV2Lib, codalLib, coreLib, cutebot, yahboom];
  // A fresh project seeds only the target; the user has then installed yahboom.
  const project: Readonly<Record<string, string>> = {
    [MICROBIT_V2_TARGET_COORDINATE]: MICROBIT_V2_TARGET_REFERENCE,
    [YAHBOOM]: `embedded:${YAHBOOM}`,
  };

  /** A persistence double recording every extensions map applied through the host. */
  function capturingPersistence(): ExtensionProjectPersistence & {
    patches: Array<Record<string, string> | undefined>;
  } {
    const patches: Array<Record<string, string> | undefined> = [];
    return {
      patches,
      updateProjectExtensions: async (extensions) => {
        patches.push(extensions);
        return {
          committed: true,
          outcome: { kind: "unchanged" as const, newProblems: [], resolvedProblems: [] },
          warnings: [],
        };
      },
    };
  }

  test("the seeded target is not an entry card, and the installed library is a manageable card with Uninstall", () => {
    const entries = buildMicrobitExtensionEntries(project, embedRecord);
    const coordinates = entries.map((entry) => entry.coordinate);
    assert.equal(coordinates.includes(MICROBIT_V2_TARGET_COORDINATE), false);
    const yahboomEntry = entries.find((entry) => entry.coordinate === YAHBOOM);
    assert.ok(yahboomEntry);
    assert.equal(yahboomEntry.installed, true);
  });

  test("the installed library is dropped from the catalog offers, while a not-installed library still offers", () => {
    const offers = buildMicrobitCatalogOffers(project, embedRecord);
    const coordinates = offers.map((offer) => offer.coordinate);
    assert.equal(coordinates.includes(YAHBOOM), false);
    assert.equal(coordinates.includes(CUTEBOT), true);
  });

  test("uninstalling the seeded target is refused as a locked platform coordinate", async () => {
    const persistence = capturingPersistence();
    const result = await uninstallMicrobitExtension(persistence, project, MICROBIT_V2_TARGET_COORDINATE, embedRecord);
    assert.equal(result.action.ok, false);
    assert.equal(result.action.code, ExtensionActionResultCode.LOCKED);
    assert.equal(persistence.patches.length, 0);
  });
});
