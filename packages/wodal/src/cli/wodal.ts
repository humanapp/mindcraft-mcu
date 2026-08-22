#!/usr/bin/env node
/**
 * The `wodal` command-line entry. Wraps the firmware hex patcher to package a
 * compiled brain into a distributable firmware hex from the command line, for
 * scripted or CI packaging.
 *
 * The `--program` input may be a binary `.mcprogram` or a JSON `.mcprogram`; a
 * JSON image is serialized to its binary form before patching.
 *
 * Usage:
 *   wodal patch --firmware <firmware.hex> --metadata <metadata.json> \
 *               --program <brain.mcprogram[.bin]> --out <patched.hex>
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { FirmwareMetadata } from "../wendoo/firmware-metadata";
import { patchFirmwareHex } from "../wendoo/firmware-patcher";
import { wodalProgramBytes } from "../wendoo/program-image-binary";

const USAGE =
  "usage: wodal patch --firmware <firmware.hex> --metadata <metadata.json> --program <brain.mcprogram[.bin]> --out <patched.hex>";

interface PatchArgs {
  firmware: string;
  metadata: string;
  program: string;
  out: string;
}

function parsePatchArgs(args: string[]): PatchArgs | null {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      return null;
    }
    flags[flag.slice(2)] = value;
  }
  const { firmware, metadata, program, out } = flags;
  if (!firmware || !metadata || !program || !out) {
    return null;
  }
  return { firmware, metadata, program, out };
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args[0] !== "patch") {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const parsed = parsePatchArgs(args.slice(1));
  if (parsed === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

  const firmwareHex = readFileSync(parsed.firmware, "utf8");
  const metadata = JSON.parse(readFileSync(parsed.metadata, "utf8")) as FirmwareMetadata;

  let program: Uint8Array;
  try {
    program = wodalProgramBytes(new Uint8Array(readFileSync(parsed.program)));
  } catch (error) {
    process.stderr.write(`wodal: ${(error as Error).message}\n`);
    return 1;
  }

  const result = patchFirmwareHex({ firmwareHex, metadata, program });
  if (!result.ok) {
    process.stderr.write(
      `wodal: program does not fit the region: needs ${result.error.requiredBytes} bytes, region holds ${result.error.regionSize}\n`
    );
    return 1;
  }

  writeFileSync(parsed.out, result.hex);
  process.stdout.write(
    `wodal: wrote ${parsed.out} (${program.length}-byte program at region offset ${metadata.regionOffset})\n`
  );
  return 0;
}

process.exit(main(process.argv));
