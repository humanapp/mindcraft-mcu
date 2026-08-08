#!/usr/bin/env node
/**
 * Builds this target's headless adapter artifact: bundles the rehearsal adapter
 * its device-runtime dependency publishes into one self-contained,
 * plain-Node-importable ES module, stamped with the target identity this
 * target's own mindcraft.json declares and carrying the device's tile
 * documentation inside it. Exits nonzero when a package the bundle would carry
 * was built before its own sources were last edited, when the manifest declares
 * no identity, or when the bundle fails.
 * Run through `npm run build:headless`.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDependencyDistsFresh,
  readTargetIdentity,
  readTileDocContent,
  StaleDependencyError,
} from "@mindcraft-lang/assistant-bridge/kit";
import { build } from "esbuild";

/** The device this app distributes, named as its device-runtime package subtree carries it. */
const DEVICE = "microbit-v2";

/** Device-runtime entry publishing this device's rehearsal adapter factory. */
const ADAPTER_ENTRY = `@mindcraft-lang/wodal/targets/${DEVICE}/rehearsal`;

/** Device-runtime package this app resolves the adapter and its documentation from. */
const DEVICE_PACKAGE = "@mindcraft-lang/wodal/package.json";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  assertDependencyDistsFresh(appDir);
} catch (cause) {
  if (!(cause instanceof StaleDependencyError)) throw cause;
  console.error(`build-headless-adapter: ${cause.message}`);
  process.exit(1);
}

const targetIdentity = readTargetIdentity(appDir);

const entryPath = fileURLToPath(import.meta.resolve(ADAPTER_ENTRY));
const devicePackageDir = dirname(fileURLToPath(import.meta.resolve(DEVICE_PACKAGE)));
const tileDocContent = readTileDocContent(join(devicePackageDir, "targets", DEVICE, "docs", "en", "tiles"));

const artifactDir = join(appDir, "dist-headless");
const artifactPath = join(artifactDir, "rehearsal", "adapter.js");

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(dirname(artifactPath), { recursive: true });

await build({
  entryPoints: [entryPath],
  outfile: artifactPath,
  bundle: true,
  platform: "node",
  format: "esm",
  define: {
    TARGET_IDENTITY: JSON.stringify(targetIdentity),
    TILE_DOC_CONTENT: JSON.stringify(tileDocContent),
  },
  logLevel: "warning",
});

console.log(`built headless adapter: ${targetIdentity} at ${relative(appDir, artifactPath)}`);
