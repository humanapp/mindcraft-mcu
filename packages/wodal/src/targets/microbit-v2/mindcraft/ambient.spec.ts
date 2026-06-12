import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildPlatformAmbientDeclarations } from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "./environment";

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("checked-in microbit-v2 ambient declarations match generated declarations", () => {
  const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
  const microbitV2Environment = createMicroBitV2Environment();

  const microbitV2Ambient = buildPlatformAmbientDeclarations(
    coreEnvironment.brainServices.runtime.types,
    microbitV2Environment.brainServices.runtime.types
  );

  assert.equal(readText("../../../../ambient/mindcraft.microbit-v2.d.ts"), microbitV2Ambient);
});
