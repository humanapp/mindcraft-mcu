import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { migrateStdlibBrainOrigins, migrateStdlibImports, resolveEmbeddedExtensions } from "@mindcraft-lang/bridge-app";
import { type AmbientFile, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { TEST_PROJECT_NAMESPACE } from "@mindcraft-lang/ts-compiler/testing";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import {
  CORE_LIB_COORDINATE,
  CORE_LIB_REFERENCE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  microbitStdlibImportRedirects,
  WODAL_LIB_COORDINATE,
  WODAL_LIB_REFERENCE,
} from "./microbit-extension-coordinates";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * The three embedded layers built from their on-disk source and bundled
 * `mindcraft.json` edges (the app's `?raw` imports are Vite-only). Mirrors the
 * embed record the app ships, so the layer edges under test are the real ones.
 */
function embeddedLayers(): EmbeddedExtension[] {
  return [
    {
      canonicalOrigin: MICROBIT_V2_LIB_COORDINATE,
      files: [
        { path: "index.ts", content: readText("../../../../packages/wodal/targets/microbit-v2/lib/index.ts") },
        { path: "image.ts", content: readText("../../../../packages/wodal/targets/microbit-v2/lib/image.ts") },
        {
          path: "mindcraft.json",
          content: readText("../../../../packages/wodal/targets/microbit-v2/lib/mindcraft.json"),
        },
      ],
    },
    {
      canonicalOrigin: WODAL_LIB_COORDINATE,
      files: [
        { path: "index.ts", content: readText("../../../../packages/wodal/lib/index.ts") },
        { path: "mindcraft.json", content: readText("../../../../packages/wodal/lib/mindcraft.json") },
      ],
    },
    {
      canonicalOrigin: CORE_LIB_COORDINATE,
      files: [
        { path: "index.ts", content: readText("../../../../external/mindcraft-lang/packages/core/lib/index.ts") },
        {
          path: "mindcraft.json",
          content: readText("../../../../external/mindcraft-lang/packages/core/lib/mindcraft.json"),
        },
      ],
    },
  ];
}

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

const MICROBIT_V2_COORDINATE = "mindcraft-lang/microbit-v2";
const WODAL_COORDINATE = "mindcraft-lang/wodal";

describe("microbit stdlib redirects -- saved-brain origin migration onto microbit-v2", () => {
  test("a brain whose image symbols carry the wodal origin migrates to the microbit-v2 origin", () => {
    const brain = {
      catalog: [
        { kind: "literal", valueType: `struct:<${WODAL_COORDINATE}:/image.ts::Image>` },
        { kind: "variable", tileId: `tile.var.factory->struct:<${WODAL_COORDINATE}:/image.ts::Image>` },
      ],
    };

    const report = migrateStdlibBrainOrigins(brain, microbitStdlibImportRedirects);

    assert.equal(report.changed, true);
    assert.equal(brain.catalog[0].valueType, `struct:<${MICROBIT_V2_COORDINATE}:/image.ts::Image>`);
    assert.equal(brain.catalog[1].tileId, `tile.var.factory->struct:<${MICROBIT_V2_COORDINATE}:/image.ts::Image>`);
  });

  test("the prior transport-prefixed wodal origin also migrates to the bare microbit-v2 coordinate", () => {
    const brain = { catalog: [{ kind: "literal", valueType: `struct:<gh:${WODAL_COORDINATE}:/image.ts::Image>` }] };

    const report = migrateStdlibBrainOrigins(brain, microbitStdlibImportRedirects);

    assert.equal(report.changed, true);
    assert.equal(brain.catalog[0].valueType, `struct:<${MICROBIT_V2_COORDINATE}:/image.ts::Image>`);
  });
});

describe("microbit stdlib redirects -- import-specifier migration onto microbit-v2", () => {
  test("a user file importing image from the wodal entry surface rewrites to the microbit-v2 entry", () => {
    const files = new Map([["draw.ts", 'import { heart } from "@ext/mindcraft-lang/wodal";\n']]);

    const result = migrateStdlibImports(
      files,
      { [WODAL_COORDINATE]: WODAL_LIB_REFERENCE },
      microbitStdlibImportRedirects
    );

    assert.equal(result.changed, true);
    assert.equal(result.changedFiles.get("draw.ts"), 'import { heart } from "@ext/mindcraft-lang/microbit-v2";\n');
    assert.equal(result.manifestBackfill[MICROBIT_V2_COORDINATE], MICROBIT_V2_LIB_REFERENCE);
    assert.deepEqual(result.manifestRemovals, [WODAL_COORDINATE]);
  });

  test("a legacy stdlib subpath import still rewrites onto the microbit-v2 entry", () => {
    const files = new Map([["draw.ts", 'import { heart } from "stdlib/image";\n']]);

    const result = migrateStdlibImports(files, undefined, microbitStdlibImportRedirects);

    assert.equal(result.changedFiles.get("draw.ts"), 'import { heart } from "@ext/mindcraft-lang/microbit-v2";\n');
  });
});

describe("microbit embedded layers -- transitive resolution of the core <- wodal <- microbit-v2 stack", () => {
  test("seeding the microbit-v2 layer alone resolves and materializes all three layers with their edges", () => {
    const resolved = resolveEmbeddedExtensions(
      { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
      embeddedLayers()
    );

    assert.deepEqual(resolved.dependencies, [{ coordinate: MICROBIT_V2_LIB_COORDINATE }]);
    const origins = resolved.dependencyMounts.map((m) => m.namespace).sort();
    assert.deepEqual(origins, [CORE_LIB_COORDINATE, MICROBIT_V2_LIB_COORDINATE, WODAL_LIB_COORDINATE]);

    const mountFor = (origin: string) => resolved.dependencyMounts.find((m) => m.namespace === origin)!;
    assert.deepEqual(mountFor(MICROBIT_V2_LIB_COORDINATE).dependencies, [{ coordinate: WODAL_LIB_COORDINATE }]);
    assert.deepEqual(mountFor(WODAL_LIB_COORDINATE).dependencies, [{ coordinate: CORE_LIB_COORDINATE }]);
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).dependencies, []);

    // The image builders materialize on the microbit-v2 layer; the lower layers are present but empty.
    assert.match(mountFor(MICROBIT_V2_LIB_COORDINATE).files.get("/image.ts") ?? "", /export function image/);
    assert.equal((mountFor(WODAL_LIB_COORDINATE).files.get("/index.ts") ?? "").trim(), "export {};");
    assert.equal((mountFor(CORE_LIB_COORDINATE).files.get("/index.ts") ?? "").trim(), "export {};");
    assert.deepEqual(resolved.warnings, []);
  });
});

describe("microbit embedded layers -- compile against the resolved stack", () => {
  test("image imports cleanly from the microbit-v2 entry, and the empty wodal placeholder yields a diagnostic", () => {
    const resolved = resolveEmbeddedExtensions(
      {
        [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE,
        [WODAL_LIB_COORDINATE]: WODAL_LIB_REFERENCE,
        [CORE_LIB_COORDINATE]: CORE_LIB_REFERENCE,
      },
      embeddedLayers()
    );
    const environment = createMicroBitV2Environment();

    const okProject = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: microbitAmbientFiles(),
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
      services: environment.brainServices,
    });
    okProject.setFiles(
      new Map([
        [
          "draw-heart.ts",
          `import { Actuator, type Context } from "mindcraft";
import { heart } from "@ext/mindcraft-lang/microbit-v2";

const heartIcon = heart();

export default Actuator({
  name: "draw heart",
  async onExecute(ctx: Context): Promise<void> {
    await ctx.microbit.display.drawImage(heartIcon, 0);
  },
});
`,
        ],
      ])
    );
    const okResult = okProject.compileAll();
    assert.equal(
      okResult.tsErrors.size,
      0,
      `image should compile from microbit-v2: ${JSON.stringify([...okResult.tsErrors])}`
    );

    const emptyProject = new UserTileProject({
      projectNamespace: TEST_PROJECT_NAMESPACE,
      ambientFiles: microbitAmbientFiles(),
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
      services: environment.brainServices,
    });
    emptyProject.setFiles(
      new Map([["draw-empty.ts", 'import { image } from "@ext/mindcraft-lang/wodal";\nexport const w = image;\n']])
    );
    const emptyResult = emptyProject.compileAll();
    assert.ok(
      emptyResult.tsErrors.size > 0,
      "the empty wodal placeholder exports nothing, so importing image is a precise diagnostic, not a crash"
    );
  });
});
