#!/usr/bin/env node
/**
 * Assembles this target's headless adapter payload: bundles the rehearsal
 * adapter its device-runtime dependency publishes into a plain-Node-importable
 * ES module, stamped with the target identity this target's own mindcraft.json
 * declares, and ships the device's tile documentation alongside it. Exits
 * nonzero when the manifest declares no identity, or when the bundle fails.
 * Run through `npm run build:headless`, which smokes the payload afterwards.
 */
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** The device this app distributes, named as its device-runtime package subtree carries it. */
const DEVICE = "microbit-v2";

/** Device-runtime entry publishing this device's rehearsal adapter factory. */
const ADAPTER_ENTRY = `@mindcraft-lang/wodal/targets/${DEVICE}/rehearsal`;

/** Device-runtime package this app resolves the adapter and its documentation from. */
const DEVICE_PACKAGE = "@mindcraft-lang/wodal/package.json";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(appDir, "target-package", "mindcraft.json");

const targetIdentity = JSON.parse(readFileSync(manifestPath, "utf8")).identity;
if (typeof targetIdentity !== "string" || targetIdentity.length === 0) {
  console.error(`build-headless-adapter: ${manifestPath} declares no identity for the headless adapter to report.`);
  process.exit(1);
}

const entryPath = fileURLToPath(import.meta.resolve(ADAPTER_ENTRY));
const devicePackageDir = dirname(fileURLToPath(import.meta.resolve(DEVICE_PACKAGE)));
const docsDir = join(devicePackageDir, "targets", DEVICE, "docs");

// The built adapter resolves its shipped tile documentation relative to its own
// location, so the payload reproduces the layout the device-runtime package
// carries: the artifact and the docs tree each at their package-relative path.
const payloadDir = join(appDir, "dist-headless");
const artifactPath = join(payloadDir, relative(devicePackageDir, entryPath));
const payloadDocsDir = join(payloadDir, relative(devicePackageDir, docsDir));

rmSync(payloadDir, { recursive: true, force: true });
mkdirSync(payloadDir, { recursive: true });

await build({
  entryPoints: [entryPath],
  outfile: artifactPath,
  bundle: true,
  platform: "node",
  format: "esm",
  define: { TARGET_IDENTITY: JSON.stringify(targetIdentity) },
  logLevel: "warning",
});

cpSync(docsDir, payloadDocsDir, { recursive: true });

console.log(`assembled headless adapter: ${targetIdentity} at ${relative(appDir, artifactPath)}`);
