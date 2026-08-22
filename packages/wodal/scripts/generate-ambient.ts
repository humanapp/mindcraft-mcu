import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreModule, createWendooEnvironment, type WendooEnvironment } from "@wendoo/core/app";
import { createMicroBitV2Environment } from "../src/targets/microbit-v2/wendoo/environment";
import { buildLayeredPlatformAmbients } from "./ambient-layers";

/**
 * One platform target whose target-specific ambient declarations are generated.
 * The emitted file is `targets/<name>/lib/wendoo.<name>.d.ts`.
 */
interface AmbientTarget {
  /** Target slug; drives the emitted file name `targets/<name>/lib/wendoo.<name>.d.ts`. */
  name: string;
  /** Builds the target's Wendoo environment, whose type registry drives the ambient. */
  createEnvironment: () => WendooEnvironment;
}

/**
 * Platform targets whose ambient declarations are generated. Add a target by
 * appending an entry; its target-specific ambient is written to
 * `targets/<name>/lib/wendoo.<name>.d.ts` on the next generation run.
 */
const TARGETS: readonly AmbientTarget[] = [
  { name: "microbit-v2", createEnvironment: createMicroBitV2Environment },
];

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codalAmbientPath = resolve(packageDir, "lib/wendoo.codal.d.ts");

const coreEnvironment = createWendooEnvironment({ modules: [coreModule()] });
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
  const targetAmbientPath = resolve(packageDir, `targets/${name}/lib/wendoo.${name}.d.ts`);
  writeFileSync(targetAmbientPath, layers.target, "utf8");
  console.log(`ambient: generated ${targetAmbientPath}`);
}
