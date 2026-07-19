import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildLayeredPlatformAmbients } from "../../../../scripts/ambient-layers";
import { createMicroBitV2Environment } from "./environment";

interface AmbientTarget {
  name: string;
  createEnvironment: () => MindcraftEnvironment;
}

const TARGETS: readonly AmbientTarget[] = [{ name: "microbit-v2", createEnvironment: createMicroBitV2Environment }];

function readText(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("checked-in wodal and target ambient declarations match generated declarations", () => {
  const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
  const coreTypes = coreEnvironment.brainServices.runtime.types;

  const layeredByTarget = TARGETS.map((target) => ({
    name: target.name,
    layers: buildLayeredPlatformAmbients(coreTypes, target.createEnvironment().brainServices.runtime.types),
  }));

  assert.equal(readText("../../../../lib/mindcraft.codal.d.ts"), layeredByTarget[0].layers.wodal);

  for (const { name, layers } of layeredByTarget) {
    assert.equal(readText(`../../../../targets/${name}/lib/mindcraft.${name}.d.ts`), layers.target);
  }
});
