import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { FileContent } from "@wendoo/app-host";
import type { EmbeddedExtension, ResolvedExtensions } from "@wendoo/bridge-app";
import { resolveProjectExtensions } from "@wendoo/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@wendoo/bridge-app/node";
import { createWorkspaceCompiler, type Mount, type WorkspaceSnapshot } from "@wendoo/ts-compiler";
import { createMicroBitV2Environment } from "@wendoo/wodal/targets/microbit-v2";
import {
  CODAL_LIB_COORDINATE,
  CORE_LIB_COORDINATE,
  MICROBIT_V2_LIB_COORDINATE,
  MICROBIT_V2_LIB_REFERENCE,
} from "../services/microbit-extension-coordinates";

function extensionDir(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * The three platform layers assembled from their on-disk `wendoo.json`
 * files. Post-migration these chain through `targets`: micro:bit v2 --targets-->
 * wodal --targets--> core.
 */
function platformLayers(): EmbeddedExtension[] {
  return [
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../packages/wodal/targets/microbit-v2/lib"),
      MICROBIT_V2_LIB_COORDINATE
    ),
    buildEmbeddedExtensionFromDir(extensionDir("../../../../packages/wodal/lib"), CODAL_LIB_COORDINATE),
    buildEmbeddedExtensionFromDir(
      extensionDir("../../../../external/wendoo-lang/packages/core/lib"),
      CORE_LIB_COORDINATE
    ),
  ];
}

/** Compiler-controlled path the core ambient declaration materializes under. */
const CORE_AMBIENT_CONTROLLED_PATH = `.libraries/${CORE_LIB_COORDINATE}/wendoo.core.d.ts`;

/**
 * A workspace source that resolves only when the core ambient (its
 * `declare module "wendoo"` surface) is in scope: it imports `NumberType`
 * and `StructType` from `"wendoo"`.
 */
const PROBE_SOURCE =
  'import { NumberType, StructType } from "wendoo";\n' +
  'export const Point = StructType({ name: "Point", fields: { x: NumberType, y: NumberType } });\n';

/**
 * A user-content actuator that `@lib`-imports the micro:bit standard-library
 * layer; it compiles only when that layer is one of the project's own
 * importable dependencies.
 */
const MY_ACTUATOR_SOURCE = `import { Actuator } from "wendoo";
import { heart } from "@lib/${MICROBIT_V2_LIB_COORDINATE}"
const icon = heart();
export default Actuator({ id: "fbkHu4V3tO8EQ8Bd", name: "my actuator", onExecute(ctx, params) {}, });
`;

function probeSnapshot(extraFiles: Readonly<Record<string, string>> = {}): WorkspaceSnapshot {
  return new Map(
    Object.entries({ "tile.ts": PROBE_SOURCE, ...extraFiles }).map(([path, content]) => [
      path,
      { kind: "file", content, etag: "e0", isReadonly: false },
    ])
  );
}

/** Compile the probe sources against a resolved closure, returning the compile result and the controlled file set. */
function compileProbe(
  resolved: ResolvedExtensions,
  extraFiles: Readonly<Record<string, string>> = {}
): {
  tsErrorCount: number;
  controlledFiles: ReadonlyMap<string, FileContent>;
} {
  const environment = createMicroBitV2Environment();
  const mounts: readonly Mount[] = [];
  const compiler = createWorkspaceCompiler({
    projectNamespace: "target-materialization-probe",
    mounts,
    environment,
    dependencies: resolved.dependencies,
    dependencyMounts: resolved.dependencyMounts,
  });
  compiler.replaceWorkspace(probeSnapshot(extraFiles));
  const result = compiler.compile();
  return { tsErrorCount: result.projectResult.tsErrors.size, controlledFiles: compiler.getCompilerControlledFiles() };
}

describe("target-driven materialization -- a targets-only project resolves its platform ambient", () => {
  test("RED: without target-driven materialization the closure is empty and the core ambient is absent", () => {
    // The same targets-only project, resolved with no project targets supplied:
    // the closure is empty, the core ambient never materializes, and the probe
    // source cannot resolve the "wendoo" module.
    const resolved = resolveProjectExtensions(undefined, { embedded: platformLayers() }, undefined);
    assert.deepEqual(resolved.dependencyMounts, [], "no platform layers materialize");

    const { tsErrorCount, controlledFiles } = compileProbe(resolved);
    assert.equal(controlledFiles.has(CORE_AMBIENT_CONTROLLED_PATH), false, "the core ambient file is not materialized");
    assert.ok(tsErrorCount > 0, "the probe source reports an unresolved 'wendoo' module");
  });

  test("GREEN: a project declaring only a target resolves the full platform stack and its ambient", () => {
    const resolved = resolveProjectExtensions(
      undefined,
      { embedded: platformLayers() },
      { [CODAL_LIB_COORDINATE]: { packageVersion: "^0.2.0" } }
    );
    const origins = resolved.origins.map((origin) => origin.origin).sort();
    assert.deepEqual(origins, [CODAL_LIB_COORDINATE, CORE_LIB_COORDINATE], "the wodal and core layers resolve");
    assert.deepEqual(resolved.warnings, [], "an embedded target resolves without warnings");

    const { tsErrorCount, controlledFiles } = compileProbe(resolved);
    assert.equal(controlledFiles.has(CORE_AMBIENT_CONTROLLED_PATH), true, "the core ambient file materializes");
    assert.equal(tsErrorCount, 0, "the probe source resolves the 'wendoo' module with no diagnostics");
  });

  test("recurse-both: a project reaching the platform through the old extensions edge still resolves the full stack", () => {
    // A project that lists the platform in its extensions map (the micro:bit v2
    // layer), whose manifest now reaches the lower layers through target edges.
    const resolved = resolveProjectExtensions(
      { [MICROBIT_V2_LIB_COORDINATE]: MICROBIT_V2_LIB_REFERENCE },
      { embedded: platformLayers() }
    );
    const origins = resolved.origins.map((origin) => origin.origin).sort();
    assert.deepEqual(origins, [CODAL_LIB_COORDINATE, CORE_LIB_COORDINATE, MICROBIT_V2_LIB_COORDINATE]);
    // The target-recursed lower layers join the project's own importable
    // dependencies alongside the listed root.
    assert.deepEqual(resolved.dependencies.map((dependency) => dependency.coordinate).sort(), [
      CODAL_LIB_COORDINATE,
      CORE_LIB_COORDINATE,
      MICROBIT_V2_LIB_COORDINATE,
    ]);
    assert.deepEqual(resolved.warnings, []);

    const { tsErrorCount, controlledFiles } = compileProbe(resolved, {
      "my-actuator/my-actuator.ts": MY_ACTUATOR_SOURCE,
    });
    assert.equal(controlledFiles.has(CORE_AMBIENT_CONTROLLED_PATH), true);
    assert.equal(tsErrorCount, 0);
  });
});
