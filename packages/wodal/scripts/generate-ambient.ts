import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { createMicroBitV2Environment } from "../src/targets/microbit-v2/mindcraft/environment";
import { buildLayeredPlatformAmbients } from "./ambient-layers";

/**
 * One platform target whose target-specific ambient declarations are generated.
 * The emitted file is `ambient/mindcraft.<name>.d.ts`.
 */
interface AmbientTarget {
  /** Target slug; drives the emitted file name `ambient/mindcraft.<name>.d.ts`. */
  name: string;
  /** Builds the target's Mindcraft environment, whose type registry drives the ambient. */
  createEnvironment: () => MindcraftEnvironment;
}

/**
 * Platform targets whose ambient declarations are generated. Add a target by
 * appending an entry; its target-specific ambient is written to
 * `ambient/mindcraft.<name>.d.ts` on the next generation run.
 */
const TARGETS: readonly AmbientTarget[] = [
  { name: "microbit-v2", createEnvironment: createMicroBitV2Environment },
];

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codalAmbientPath = resolve(packageDir, "ambient/mindcraft.codal.d.ts");

const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
const coreTypes = coreEnvironment.brainServices.runtime.types;

const layeredByTarget = TARGETS.map((target) => ({
  name: target.name,
  layers: buildLayeredPlatformAmbients(coreTypes, target.createEnvironment().brainServices.runtime.types),
}));

// The wodal-general device surface is shared across all targets and written
// once. Its device types are registered only on the concrete targets today, so
// the shared layer is taken from the first target's build.
writeFileSync(codalAmbientPath, layeredByTarget[0].layers.wodal, "utf8");
console.log(`ambient: generated ${codalAmbientPath}`);

for (const { name, layers } of layeredByTarget) {
  const targetAmbientPath = resolve(packageDir, `ambient/mindcraft.${name}.d.ts`);
  writeFileSync(targetAmbientPath, layers.target, "utf8");
  console.log(`ambient: generated ${targetAmbientPath}`);
}
