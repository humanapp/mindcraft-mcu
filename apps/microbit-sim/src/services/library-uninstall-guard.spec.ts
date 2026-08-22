import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createInMemoryProjectFileSystem } from "@wendoo-lang/app-host";
import type { EmbeddedExtension } from "@wendoo-lang/bridge-app";
import { collectMicrobitLibraryUninstallImpact, type UninstallGuardHost } from "./library-uninstall-guard";

const CUTEBOT = "acme/lib-cutebot";

function embedded(coordinate: string): EmbeddedExtension {
  return {
    canonicalOrigin: coordinate,
    files: [
      {
        path: "wendoo.json",
        content: JSON.stringify({ name: coordinate, version: "1.0.0", files: ["index.ts"] }),
      },
      { path: "index.ts", content: "export {};" },
    ],
  };
}

/** A persisted brain with one rule referencing an actuator tile owned by `ns`. */
function brainJsonUsing(ns: string): Record<string, unknown> {
  return {
    version: 1,
    id: "brain00000000001",
    name: "Driver",
    catalog: [],
    pages: [
      {
        version: 2,
        pageId: "page000000000001",
        name: "Page 1",
        rules: [
          {
            version: 1,
            when: [],
            do: [{ k: "action", area: "actuator", id: "abcd000000000001", ns }],
            children: [],
          },
        ],
      },
    ],
  };
}

interface StubBrain {
  json: unknown;
  name(): string;
}

function stubHost(brains: Record<string, Record<string, unknown>>, files: Record<string, string>): UninstallGuardHost {
  const filesystem = createInMemoryProjectFileSystem();
  let etag = 0;
  for (const [path, content] of Object.entries(files)) {
    filesystem.applyLocalChange({ action: "write", path, content, newEtag: `e${etag++}` });
  }
  const byKey = new Map<string, StubBrain>(
    Object.entries(brains).map(([key, json]) => [key, { json, name: () => `${key} name` }])
  );
  return {
    getCachedBrainKeys: () => [...byKey.keys()],
    getCachedBrain: (key) => byKey.get(key),
    serializeBrainForStorage: (brain) => (brain as StubBrain).json,
    projectFileSystem: filesystem,
  };
}

describe("collectMicrobitLibraryUninstallImpact", () => {
  test("assembles cached brains by display name and user files by path", () => {
    const host = stubHost(
      { driver: brainJsonUsing(CUTEBOT), quiet: brainJsonUsing("acme/lib-other") },
      {
        "src/drive.ts": `import { drive } from "@lib/${CUTEBOT}";\n`,
        "src/main.ts": "export {};\n",
      }
    );
    const impact = collectMicrobitLibraryUninstallImpact(host, { [CUTEBOT]: `embedded:${CUTEBOT}` }, CUTEBOT, [
      embedded(CUTEBOT),
    ]);
    assert.deepEqual(impact.brainNames, ["driver name"]);
    assert.deepEqual(impact.filePaths, ["src/drive.ts"]);
  });

  test("reports an empty impact when nothing uses the library", () => {
    const host = stubHost({ quiet: brainJsonUsing("acme/lib-other") }, { "src/main.ts": "export {};\n" });
    const impact = collectMicrobitLibraryUninstallImpact(host, { [CUTEBOT]: `embedded:${CUTEBOT}` }, CUTEBOT, [
      embedded(CUTEBOT),
    ]);
    assert.deepEqual(impact.brainNames, []);
    assert.deepEqual(impact.filePaths, []);
  });
});
