import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type AmbientFile, UserTileProject } from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { groupExampleFiles } from "./index.js";

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

/**
 * Reconstructs the `?raw` glob record from disk by walking the example folders,
 * keyed as `./<folder>/<path>` to match the bundler's glob keys.
 */
function readExampleModules(): Record<string, string> {
  const examplesDir = fileURLToPath(new URL(".", import.meta.url));
  const raw: Record<string, string> = {};
  for (const folder of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const folderPath = fileURLToPath(new URL(`./${folder.name}/`, import.meta.url));
    for (const entry of readdirSync(folderPath, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue;
      const path = `${entry.parentPath.slice(folderPath.length)}${entry.name}`.split("\\").join("/");
      raw[`./${folder.name}/${path}`] = readFileSync(`${folderPath}${path}`, "utf8");
    }
  }
  return raw;
}

describe("bundled examples", () => {
  it("groups the starter example into an ExampleDefinition", () => {
    const examples = groupExampleFiles(readExampleModules());

    const buttonA = examples.find((example) => example.folder === "ButtonA");
    assert.ok(buttonA, "expected the ButtonA starter example to load");
    assert.ok(
      buttonA.files.some((file) => file.path === "button-a.ts"),
      "expected ButtonA to contain button-a.ts"
    );
  });

  it("compiles every example .ts against the microbit-v2 surface without diagnostics", () => {
    const environment = createMicroBitV2Environment();
    const examples = groupExampleFiles(readExampleModules());

    const tileFiles = new Map<string, string>();
    for (const example of examples) {
      for (const file of example.files) {
        if (file.path.endsWith(".ts")) {
          tileFiles.set(`${example.folder}/${file.path}`, file.content);
        }
      }
    }
    assert.ok(tileFiles.size > 0, "expected at least one example tile to compile");

    const project = new UserTileProject({
      ambientFiles: microbitAmbientFiles(),
      services: environment.brainServices,
    });
    project.setFiles(tileFiles);
    const compileResult = project.compileAll();
    assert.equal(
      compileResult.tsErrors.size,
      0,
      `Unexpected TypeScript diagnostics: ${JSON.stringify([...compileResult.tsErrors])}`
    );
  });
});
