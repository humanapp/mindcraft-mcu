import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import { resolveEmbeddedExtensions } from "@mindcraft-lang/bridge-app";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import {
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
  WODAL_LIB_COORDINATE,
} from "./microbit-extension-coordinates";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * The three embedded layers built from their on-disk source and bundled
 * `mindcraft.json` edges (the app's `?raw` imports are Vite-only). Mirrors the
 * embed record the app ships, carrying each layer's real edges and ambient
 * `.d.ts`.
 */
function embeddedLayers(): EmbeddedExtension[] {
  return [
    {
      canonicalOrigin: MICROBIT_V2_LIB_COORDINATE,
      files: [
        { path: "index.ts", content: readText("../../../../packages/wodal/targets/microbit-v2/lib/index.ts") },
        { path: "image.ts", content: readText("../../../../packages/wodal/targets/microbit-v2/lib/image.ts") },
        {
          path: "mindcraft.microbit-v2.d.ts",
          content: readText("../../../../packages/wodal/ambient/mindcraft.microbit-v2.d.ts"),
        },
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
        { path: "mindcraft.wodal.d.ts", content: readText("../../../../packages/wodal/ambient/mindcraft.wodal.d.ts") },
        { path: "mindcraft.json", content: readText("../../../../packages/wodal/lib/mindcraft.json") },
      ],
    },
    {
      canonicalOrigin: CORE_LIB_COORDINATE,
      files: [
        { path: "index.ts", content: readText("../../../../external/mindcraft-lang/packages/core/lib/index.ts") },
        {
          path: "mindcraft.core.d.ts",
          content: readText("../../../../external/mindcraft-lang/packages/core/ambient/mindcraft.core.d.ts"),
        },
        {
          path: "mindcraft.json",
          content: readText("../../../../external/mindcraft-lang/packages/core/lib/mindcraft.json"),
        },
      ],
    },
  ];
}

describe("microbit embedded layers -- transitive resolution of the core <- wodal <- microbit-v2 stack", () => {
  test("seeding the microbit-v2 layer alone resolves all three layers with their edges and ambient declarations", () => {
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

    // Each layer carries its own ambient `.d.ts` as extension content and declares it in its manifest.
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).ambient, ["mindcraft.core.d.ts"]);
    assert.deepEqual(mountFor(WODAL_LIB_COORDINATE).ambient, ["mindcraft.wodal.d.ts"]);
    assert.deepEqual(mountFor(MICROBIT_V2_LIB_COORDINATE).ambient, ["mindcraft.microbit-v2.d.ts"]);
    assert.match(mountFor(CORE_LIB_COORDINATE).files.get("/mindcraft.core.d.ts") ?? "", /declare var Buffer/);
    assert.match(mountFor(WODAL_LIB_COORDINATE).files.get("/mindcraft.wodal.d.ts") ?? "", /interface Button/);
    assert.match(
      mountFor(MICROBIT_V2_LIB_COORDINATE).files.get("/mindcraft.microbit-v2.d.ts") ?? "",
      /interface MicroBit\b/
    );
  });
});

describe("microbit embedded layers -- ambient declarations arrive through the resolved extensions", () => {
  test("user code resolves types spanning all three layers with no root ambient mount, and the .d.ts materialize under .extensions/", () => {
    const resolved = resolveEmbeddedExtensions(
      { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
      embeddedLayers()
    );
    const environment = createMicroBitV2Environment();

    // No root ambient mounts; platform types resolve entirely through the
    // resolved layer extensions' ambient `.d.ts`.
    const mounts: readonly Mount[] = [];
    const compiler = createWorkspaceCompiler({
      projectNamespace: "probe-project",
      mounts,
      environment,
      dependencies: resolved.dependencies,
      dependencyMounts: resolved.dependencyMounts,
    });

    const crossLayer = `import { Actuator, type Context, type Image, type Button, type MicroBit } from "mindcraft";
import { heart } from "@ext/mindcraft-lang/microbit-v2";

const heartIcon: Image = heart();

export default Actuator({
  name: "cross layer",
  async onExecute(ctx: Context): Promise<void> {
    const microbit: MicroBit = ctx.microbit;
    const buttonA: Button = microbit.buttonA;
    const pixels: Buffer = heartIcon.pixels;
    await ctx.microbit.display.drawImage(heartIcon, 0);
    void buttonA;
    void pixels;
  },
});
`;

    const snapshot: WorkspaceSnapshot = new Map([
      ["cross-layer.ts", { kind: "file", content: crossLayer, etag: "e0", isReadonly: false }],
    ]);
    compiler.replaceWorkspace(snapshot);
    const result = compiler.compile();

    assert.equal(
      result.projectResult.tsErrors.size,
      0,
      `types spanning core (Buffer/Context), wodal (Image/Button), and microbit-v2 (MicroBit) must resolve: ${JSON.stringify(
        [...result.projectResult.tsErrors]
      )}`
    );

    // The layer ambient `.d.ts` are inspectable in the project file tree under
    // each layer's `.extensions/<owner>/<repo>/` subtree.
    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(".extensions/mindcraft-lang/core/mindcraft.core.d.ts"),
      "the core ambient materializes under .extensions/"
    );
    assert.ok(
      controlled.has(".extensions/mindcraft-lang/wodal/mindcraft.wodal.d.ts"),
      "the wodal ambient materializes under .extensions/"
    );
    assert.ok(
      controlled.has(".extensions/mindcraft-lang/microbit-v2/mindcraft.microbit-v2.d.ts"),
      "the microbit-v2 ambient materializes under .extensions/"
    );
  });
});
