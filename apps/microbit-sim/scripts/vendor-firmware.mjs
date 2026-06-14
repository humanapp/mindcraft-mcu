#!/usr/bin/env node
/**
 * Copies the built micro:bit v2 firmware (the matched hex + metadata pair) from
 * the C++ device build output into this app's bundled assets. Run after
 * rebuilding the firmware. Both source files are checked before either is copied,
 * so the bundled pair is never left half-updated.
 */
import { copyFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(appDir, "..", "..", "cpp", "out", "microbit-v2");
const targetDir = join(appDir, "src", "assets", "firmware");

const files = [
  { from: "MICROBIT.hex", to: "microbit-v2.hex" },
  { from: "MICROBIT.metadata.json", to: "microbit-v2.metadata.json" },
];

const missing = files.filter((file) => !existsSync(join(sourceDir, file.from)));
if (missing.length > 0) {
  console.error(`vendor-firmware: missing build output in ${sourceDir}:`);
  for (const file of missing) {
    console.error(`  ${file.from}`);
  }
  console.error("Build the micro:bit v2 firmware first (see cpp/README.md).");
  process.exit(1);
}

for (const file of files) {
  const target = join(targetDir, file.to);
  copyFileSync(join(sourceDir, file.from), target);
  console.log(`vendored ${file.to} (${statSync(target).size} bytes)`);
}
