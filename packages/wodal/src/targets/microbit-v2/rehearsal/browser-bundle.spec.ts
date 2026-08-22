import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";
import { build } from "esbuild";
import { MICROBIT_V2_TILE_DOCS } from "../wendoo/tile-docs";

/** The module a host imports to construct this target's adapter. */
const ENTRY = fileURLToPath(new URL("./adapter.ts", import.meta.url));

/** True when `source` names a Node builtin, with or without its `node:` prefix. */
function isNodeBuiltin(source: string): boolean {
  return source.startsWith("node:") || builtinModules.includes(source);
}

/** Records every Node builtin the graph asks for, and marks each one external. */
function recordNodeBuiltins(reached: string[]): Plugin {
  return {
    name: "record-node-builtins",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (!isNodeBuiltin(args.path)) return undefined;
        reached.push(`${args.path} from ${args.importer}`);
        return { path: args.path, external: true };
      });
    },
  };
}

/** Bundle {@link ENTRY} for a browser, returning the reached builtins and the emitted code. */
async function bundleForBrowser(): Promise<{ reached: string[]; code: string }> {
  const reached: string[] = [];
  const built = await build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins: [recordNodeBuiltins(reached)],
  });
  return { reached, code: built.outputFiles.map((file) => file.text).join("\n") };
}

describe("the device adapter bundled for a browser", () => {
  test("builds, and reaches no Node builtin on the way", async () => {
    const { reached, code } = await bundleForBrowser();

    assert.deepEqual(reached, [], "the browser module graph reaches Node builtins");
    assert.ok(code.includes("createTargetAdapter"), "the bundle publishes no adapter factory");
    const uncarried = MICROBIT_V2_TILE_DOCS.filter((entry) => !code.includes(`"${entry.contentKey}"`));
    assert.deepEqual(
      uncarried.map((entry) => entry.contentKey),
      [],
      "the bundle carries no documentation for these tiles"
    );
  });
});
