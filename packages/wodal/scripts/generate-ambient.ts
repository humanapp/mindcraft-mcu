import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildPlatformAmbientDeclarations } from "@mindcraft-lang/ts-compiler";
import { createMicroBitV2Environment } from "../src/targets/microbit-v2/mindcraft/environment";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ambientPath = resolve(packageDir, "ambient/mindcraft.microbit-v2.d.ts");

const coreEnvironment = createMindcraftEnvironment({ modules: [coreModule()] });
const microbitV2Environment = createMicroBitV2Environment();

const ambient = buildPlatformAmbientDeclarations(
  coreEnvironment.brainServices.runtime.types,
  microbitV2Environment.brainServices.runtime.types
);

writeFileSync(ambientPath, ambient, "utf8");

console.log(`ambient: generated ${ambientPath}`);
