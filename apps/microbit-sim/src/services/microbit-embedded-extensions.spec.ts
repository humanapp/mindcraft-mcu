import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EmbeddedExtension } from "@mindcraft-lang/bridge-app";
import {
  findEmbeddedExtensionsMissingStableIds,
  formatEmbeddedExtensionIdViolations,
  resolveProjectExtensions,
} from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import {
  CODAL_LIB_COORDINATE,
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
} from "./microbit-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The three embedded layers assembled from each extension's own `mindcraft.json`
 * `files` list through the shared loader -- the single content-assembly path the
 * app's Vite provider also uses. The layer stack is core <- wodal <- microbit-v2.
 */
function embeddedLayers(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../packages/wodal/targets/microbit-v2/lib"),
      MICROBIT_V2_LIB_COORDINATE
    ),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/wodal/lib"), CODAL_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../external/mindcraft-lang/packages/core/lib"),
      CORE_LIB_COORDINATE
    ),
  ];
}

describe("microbit embedded layers -- transitive resolution of the core <- codal <- microbit-v2 stack", () => {
  test("seeding the microbit-v2 layer alone resolves all three layers with their edges and ambient declarations", () => {
    const resolved = resolveProjectExtensions(
      { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
      { embedded: embeddedLayers() }
    );

    assert.deepEqual(resolved.dependencies, [{ coordinate: MICROBIT_V2_LIB_COORDINATE }]);
    const origins = resolved.dependencyMounts.map((m) => m.namespace).sort();
    assert.deepEqual(origins, [CODAL_LIB_COORDINATE, CORE_LIB_COORDINATE, MICROBIT_V2_LIB_COORDINATE]);

    const mountFor = (origin: string) => resolved.dependencyMounts.find((m) => m.namespace === origin)!;
    assert.deepEqual(mountFor(MICROBIT_V2_LIB_COORDINATE).dependencies, [{ coordinate: CODAL_LIB_COORDINATE }]);
    assert.deepEqual(mountFor(CODAL_LIB_COORDINATE).dependencies, [{ coordinate: CORE_LIB_COORDINATE }]);
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).dependencies, []);

    // Each layer carries its own ambient `.d.ts` as extension content and declares it in its manifest.
    assert.deepEqual(mountFor(CORE_LIB_COORDINATE).ambient, ["mindcraft.core.d.ts"]);
    assert.deepEqual(mountFor(CODAL_LIB_COORDINATE).ambient, ["mindcraft.codal.d.ts"]);
    assert.deepEqual(mountFor(MICROBIT_V2_LIB_COORDINATE).ambient, ["mindcraft.microbit-v2.d.ts"]);
    assert.match(mountFor(CORE_LIB_COORDINATE).files.get("/mindcraft.core.d.ts") ?? "", /declare var Buffer/);
    assert.match(mountFor(CODAL_LIB_COORDINATE).files.get("/mindcraft.codal.d.ts") ?? "", /interface Button/);
    assert.match(
      mountFor(MICROBIT_V2_LIB_COORDINATE).files.get("/mindcraft.microbit-v2.d.ts") ?? "",
      /interface MicroBit\b/
    );
  });
});

describe("microbit embedded layers -- ambient declarations arrive through the resolved extensions", () => {
  test("user code resolves types spanning all three layers with no root ambient mount, and the .d.ts materialize under .libraries/", () => {
    const resolved = resolveProjectExtensions(
      { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
      { embedded: embeddedLayers() }
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
import { heart } from "@lib/mindcraft-lang/microbit-v2";

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
    // each layer's `.libraries/<owner>/<repo>/` subtree.
    const controlled = compiler.getCompilerControlledFiles();
    assert.ok(
      controlled.has(".libraries/mindcraft-lang/core/mindcraft.core.d.ts"),
      "the core ambient materializes under .libraries/"
    );
    assert.ok(
      controlled.has(".libraries/mindcraft-lang/codal/mindcraft.codal.d.ts"),
      "the codal ambient materializes under .libraries/"
    );
    assert.ok(
      controlled.has(".libraries/mindcraft-lang/microbit-v2/mindcraft.microbit-v2.d.ts"),
      "the microbit-v2 ambient materializes under .libraries/"
    );
  });
});

describe("microbit embedded extensions -- every declaration ships a stable id", () => {
  test("no embedded extension declares a tile without an explicit stable id", () => {
    const services = createMicroBitV2Environment().brainServices;
    const violations = findEmbeddedExtensionsMissingStableIds(embeddedLayers(), services);
    assert.deepEqual(violations, [], formatEmbeddedExtensionIdViolations(violations));
  });
});

describe("microbit embedded layers -- the manifest-driven bundle matches the hand-assembled one", () => {
  test("the microbit-v2 layer's manifest-driven path->content set equals its hand-assembled set", () => {
    const built = buildEmbeddedExtensionFromDir(
      extensionDir("../../../../packages/wodal/targets/microbit-v2/lib"),
      MICROBIT_V2_LIB_COORDINATE
    );
    const read = (rel: string) => readFileSync(extensionDir(rel), "utf8");
    const handAssembled = new Map([
      ["index.ts", read("../../../../packages/wodal/targets/microbit-v2/lib/index.ts")],
      ["image.ts", read("../../../../packages/wodal/targets/microbit-v2/lib/image.ts")],
      ["mindcraft.microbit-v2.d.ts", read("../../../../packages/wodal/ambient/mindcraft.microbit-v2.d.ts")],
      ["mindcraft.json", read("../../../../packages/wodal/targets/microbit-v2/lib/mindcraft.json")],
    ]);
    const builtByPath = new Map(built.files.map((f) => [f.path, f.content]));
    assert.deepEqual(builtByPath, handAssembled);
  });
});
