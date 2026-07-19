import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CATALOG_ENTRY_KIND_EXTENSION, validateExtensionCatalogDocument } from "@mindcraft-lang/app-host";
import type { EmbeddedExtension, FetchedExtensionContentMap } from "@mindcraft-lang/bridge-app";
import { buildMicrobitCatalogOffers, buildMicrobitExtensionEntries } from "./microbit-extension-browser";
import { MICROBIT_V2_LIB_COORDINATE, MICROBIT_V2_LIB_REFERENCE } from "./microbit-extension-coordinates";
import microbitLibraryCatalogDocument from "./microbit-library-catalog.json";

const CUTEBOT = "mindcraft-lang/lib-microbit-cutebot";
const YAHBOOM = "mindcraft-lang/lib-microbit-yahboom-gamepad";

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

  test("the seeded cutebot and yahboom offers are compatible with a micro:bit project and marked not installed", () => {
    const offers = buildMicrobitCatalogOffers(project, embedRecord);
    assert.deepEqual(offers.map((offer) => offer.coordinate).sort(), [CUTEBOT, YAHBOOM].sort());
    assert.ok(offers.every((offer) => offer.installed === false));
    for (const offer of offers) {
      assert.equal(offer.ref, `embedded:${offer.coordinate}`);
    }
  });

  test("a project carrying an offer's coordinate marks that offer installed", () => {
    const offers = buildMicrobitCatalogOffers({ ...project, [CUTEBOT]: `embedded:${CUTEBOT}` }, embedRecord);
    assert.equal(offers.find((offer) => offer.coordinate === CUTEBOT)?.installed, true);
    assert.equal(offers.find((offer) => offer.coordinate === YAHBOOM)?.installed, false);
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
