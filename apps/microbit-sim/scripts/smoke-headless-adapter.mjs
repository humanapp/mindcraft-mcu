#!/usr/bin/env node
/**
 * Smoke-loads the assembled headless adapter in a fresh Node process and checks
 * the adapter surface, the contract version, and the target identity it reports
 * against the identity this target's own mindcraft.json declares, then reads its
 * tile documentation to confirm the artifact resolves the docs the payload ships
 * beside it. Exits nonzero when the payload is missing, when the artifact does
 * not load and publish a conforming adapter, or when it resolves no
 * documentation.
 * Run through `npm run build:headless`, which assembles the payload first.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkArtifactLoads } from "@mindcraft-lang/assistant-bridge/kit";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = join(appDir, "dist-headless", "dist", "targets", "microbit-v2", "rehearsal", "adapter.js");
const targetIdentity = JSON.parse(readFileSync(join(appDir, "target-package", "mindcraft.json"), "utf8")).identity;

if (!existsSync(entryPath)) {
  console.error(`smoke-headless-adapter: no adapter at ${entryPath}.`);
  console.error("Run `npm run build:headless` to assemble the payload and smoke it.");
  process.exit(1);
}

const check = await checkArtifactLoads(pathToFileURL(entryPath), { targetIdentity });
if (!check.ok) {
  console.error(`smoke-headless-adapter: ${check.detail}`);
  process.exit(1);
}

const { createTargetAdapter } = await import(pathToFileURL(entryPath).href);
const docs = createTargetAdapter().tileDocs();
if (docs.size === 0) {
  console.error(`smoke-headless-adapter: ${entryPath} resolved no tile documentation from the payload.`);
  process.exit(1);
}

console.log(
  `smoked headless adapter: ${targetIdentity} loaded under Node with its full surface and ${docs.size} documented tiles.`
);
