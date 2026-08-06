#!/usr/bin/env node
/**
 * Smoke-loads a built rehearsal adapter artifact in a fresh Node process and
 * checks the adapter surface, the contract version, and the package name it
 * reports against this package's own package.json, then reads its tile
 * documentation to confirm the artifact resolves the shipped docs tree from its
 * own built location. Exits nonzero when the artifact is missing, when it does
 * not load and publish a conforming adapter, or when it ships no documentation.
 *
 * Usage: node scripts/smoke-rehearsal-adapter.mjs <package-relative artifact path>
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkArtifactLoads } from "@mindcraft-lang/assistant-bridge/kit";

const artifact = process.argv[2];
if (!artifact) {
  console.error("usage: node scripts/smoke-rehearsal-adapter.mjs <package-relative artifact path>");
  process.exit(1);
}

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = join(packageDir, artifact);
const packageName = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).name;

if (!existsSync(entryPath)) {
  console.error(`smoke-rehearsal-adapter: no adapter at ${entryPath}.`);
  console.error("Build the adapter before smoking it.");
  process.exit(1);
}

const check = await checkArtifactLoads(pathToFileURL(entryPath), { packageName });
if (!check.ok) {
  console.error(`smoke-rehearsal-adapter: ${check.detail}`);
  process.exit(1);
}

const { createTargetAdapter } = await import(pathToFileURL(entryPath).href);
const docs = createTargetAdapter().tileDocs();
if (docs.size === 0) {
  console.error(`smoke-rehearsal-adapter: ${entryPath} resolved no tile documentation from its built location.`);
  process.exit(1);
}

console.log(
  `smoked rehearsal adapter: ${packageName} loaded under Node with its full surface and ${docs.size} documented tiles.`
);
