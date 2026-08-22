import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type FirmwareMetadata,
  ON_FLASH_FORMAT_VERSION,
  ON_FLASH_HEADER_SIZE,
  ON_FLASH_REGION_MAGIC_HEX,
} from "./firmware-metadata";
import { FIRMWARE_PATCH_PROGRAM_TOO_LARGE, patchFirmwareHex } from "./firmware-patcher";

// A minimal but valid firmware hex: one data record plus the end-of-file
// record, with CRLF line endings (the convention the real firmware hex uses).
const STUB_FIRMWARE_HEX = ":04000000DEADBEEFC4\r\n:00000001FF\r\n";

// Mirrors the real micro:bit v2 build's region placement (page-aligned firmware
// end at 0x39000, region running to 0x73000).
const STUB_METADATA: FirmwareMetadata = {
  schemaVersion: 1,
  regionOffset: 0x39000,
  regionSize: 0x3a000,
  regionMagic: ON_FLASH_REGION_MAGIC_HEX,
  onFlashFormatVersion: ON_FLASH_FORMAT_VERSION,
};

function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`../targets/microbit-v2/wendoo/__fixtures__/${relative}`, import.meta.url));
}

function buttonDisplayProgram(): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath("button-display.mcprogram.bin")));
}

/** The 5-byte on-flash header (magic plus format version) the patcher writes. */
function expectedHeader(): Uint8Array {
  const header = new Uint8Array(ON_FLASH_HEADER_SIZE);
  for (let i = 0; i < ON_FLASH_REGION_MAGIC_HEX.length / 2; i++) {
    header[i] = Number.parseInt(ON_FLASH_REGION_MAGIC_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  header[ON_FLASH_HEADER_SIZE - 1] = ON_FLASH_FORMAT_VERSION;
  return header;
}

/**
 * An independent Intel HEX reader: applies type-04 (extended linear address)
 * and type-00 (data) records to reconstruct the bytes covering
 * [offset, offset + length), verifying each record's checksum. Deliberately
 * separate logic from the writer under test.
 */
function readHexRegion(hexText: string, offset: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let upper = 0;
  for (const rawLine of hexText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith(":")) {
      continue;
    }
    const bytes: number[] = [];
    for (let i = 1; i < line.length; i += 2) {
      bytes.push(Number.parseInt(line.slice(i, i + 2), 16));
    }
    const sum = bytes.reduce((a, b) => a + b, 0) & 0xff;
    assert.equal(sum, 0, `record fails its checksum: ${line}`);
    const count = bytes[0];
    const addr16 = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = bytes.slice(4, 4 + count);
    if (recordType === 0x04) {
      upper = (data[0] << 8) | data[1];
    } else if (recordType === 0x00) {
      const base = upper * 0x10000 + addr16;
      for (let i = 0; i < count; i++) {
        const abs = base + i;
        if (abs >= offset && abs < offset + length) {
          out[abs - offset] = data[i];
        }
      }
    }
  }
  return out;
}

function countExtendedLinearRecords(hexText: string): number {
  return hexText.split(/\r?\n/).filter((line) => /^:02000004/i.test(line.trim())).length;
}

test("patching is deterministic and preserves the firmware's line endings", () => {
  const program = buttonDisplayProgram();
  const first = patchFirmwareHex({ firmwareHex: STUB_FIRMWARE_HEX, metadata: STUB_METADATA, program });
  const second = patchFirmwareHex({ firmwareHex: STUB_FIRMWARE_HEX, metadata: STUB_METADATA, program });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.ok(first.ok && second.ok);
  assert.equal(first.hex, second.hex);
  assert.ok(first.hex.includes("\r\n"));
});

test("the patched region reads back as the header followed by the program", () => {
  const program = buttonDisplayProgram();
  const result = patchFirmwareHex({ firmwareHex: STUB_FIRMWARE_HEX, metadata: STUB_METADATA, program });
  assert.ok(result.ok);

  const expected = new Uint8Array(ON_FLASH_HEADER_SIZE + program.length);
  expected.set(expectedHeader(), 0);
  expected.set(program, ON_FLASH_HEADER_SIZE);

  const actual = readHexRegion(result.hex, STUB_METADATA.regionOffset, expected.length);
  assert.deepEqual(actual, expected);
});

test("the firmware's original records and the end-of-file record are preserved", () => {
  const result = patchFirmwareHex({
    firmwareHex: STUB_FIRMWARE_HEX,
    metadata: STUB_METADATA,
    program: buttonDisplayProgram(),
  });
  assert.ok(result.ok);
  assert.ok(result.hex.startsWith(":04000000DEADBEEFC4\r\n"));
  assert.ok(result.hex.trimEnd().endsWith(":00000001FF"));
});

test("a program that does not fit the region is rejected", () => {
  const program = buttonDisplayProgram();
  const tightMetadata: FirmwareMetadata = { ...STUB_METADATA, regionSize: ON_FLASH_HEADER_SIZE + program.length - 1 };
  const result = patchFirmwareHex({ firmwareHex: STUB_FIRMWARE_HEX, metadata: tightMetadata, program });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.error.code, FIRMWARE_PATCH_PROGRAM_TOO_LARGE);
  assert.equal(result.error.requiredBytes, ON_FLASH_HEADER_SIZE + program.length);
  assert.equal(result.error.regionSize, tightMetadata.regionSize);
});

test("a program exactly filling the region is accepted", () => {
  const program = buttonDisplayProgram();
  const exactMetadata: FirmwareMetadata = { ...STUB_METADATA, regionSize: ON_FLASH_HEADER_SIZE + program.length };
  const result = patchFirmwareHex({ firmwareHex: STUB_FIRMWARE_HEX, metadata: exactMetadata, program });
  assert.ok(result.ok);
});

test("a region payload crossing a 64 KiB boundary emits a new linear-address record per page", () => {
  // 0x3fff0 + 5-byte header + 64-byte program spans 0x3fff0..0x40044, crossing
  // the 0x40000 boundary, so the writer must emit two type-04 records.
  const program = new Uint8Array(64);
  for (let i = 0; i < program.length; i++) {
    program[i] = (i * 7) & 0xff;
  }
  const metadata: FirmwareMetadata = { ...STUB_METADATA, regionOffset: 0x3fff0, regionSize: 0x10000 };
  const result = patchFirmwareHex({ firmwareHex: STUB_FIRMWARE_HEX, metadata, program });
  assert.ok(result.ok);

  assert.equal(countExtendedLinearRecords(result.hex), 2);

  const expected = new Uint8Array(ON_FLASH_HEADER_SIZE + program.length);
  expected.set(expectedHeader(), 0);
  expected.set(program, ON_FLASH_HEADER_SIZE);
  const actual = readHexRegion(result.hex, metadata.regionOffset, expected.length);
  assert.deepEqual(actual, expected);
});

test("the wodal CLI builds the same hex the core produces", () => {
  const dir = mkdtempSync(join(tmpdir(), "wodal-cli-"));
  const firmwarePath = join(dir, "firmware.hex");
  const metadataPath = join(dir, "metadata.json");
  const programPath = fixturePath("button-display.mcprogram.bin");
  const outPath = join(dir, "patched.hex");
  writeFileSync(firmwarePath, STUB_FIRMWARE_HEX);
  writeFileSync(metadataPath, `${JSON.stringify(STUB_METADATA, null, 2)}\n`);

  execFileSync(
    "node_modules/.bin/tsx",
    [
      "src/cli/wodal.ts",
      "patch",
      "--firmware",
      firmwarePath,
      "--metadata",
      metadataPath,
      "--program",
      programPath,
      "--out",
      outPath,
    ],
    { stdio: "pipe" }
  );

  const cliHex = readFileSync(outPath, "utf8");
  const core = patchFirmwareHex({
    firmwareHex: STUB_FIRMWARE_HEX,
    metadata: STUB_METADATA,
    program: buttonDisplayProgram(),
  });
  assert.ok(core.ok);
  assert.equal(cliHex, core.hex);
});

test("the wodal CLI accepts a JSON .mcprogram and produces the same hex as the binary form", () => {
  const dir = mkdtempSync(join(tmpdir(), "wodal-cli-"));
  const firmwarePath = join(dir, "firmware.hex");
  const metadataPath = join(dir, "metadata.json");
  writeFileSync(firmwarePath, STUB_FIRMWARE_HEX);
  writeFileSync(metadataPath, `${JSON.stringify(STUB_METADATA, null, 2)}\n`);

  function runCli(programPath: string, outName: string): string {
    const outPath = join(dir, outName);
    execFileSync(
      "node_modules/.bin/tsx",
      [
        "src/cli/wodal.ts",
        "patch",
        "--firmware",
        firmwarePath,
        "--metadata",
        metadataPath,
        "--program",
        programPath,
        "--out",
        outPath,
      ],
      { stdio: "pipe" }
    );
    return readFileSync(outPath, "utf8");
  }

  const fromJson = runCli(fixturePath("button-display.mcprogram"), "from-json.hex");
  const fromBinary = runCli(fixturePath("button-display.mcprogram.bin"), "from-binary.hex");
  assert.equal(fromJson, fromBinary);
});

test("the wodal CLI exits non-zero when the program does not fit", () => {
  const dir = mkdtempSync(join(tmpdir(), "wodal-cli-"));
  const firmwarePath = join(dir, "firmware.hex");
  const metadataPath = join(dir, "metadata.json");
  const outPath = join(dir, "patched.hex");
  const program = buttonDisplayProgram();
  const tightMetadata: FirmwareMetadata = { ...STUB_METADATA, regionSize: ON_FLASH_HEADER_SIZE + program.length - 1 };
  writeFileSync(firmwarePath, STUB_FIRMWARE_HEX);
  writeFileSync(metadataPath, `${JSON.stringify(tightMetadata, null, 2)}\n`);

  assert.throws(() =>
    execFileSync(
      "node_modules/.bin/tsx",
      [
        "src/cli/wodal.ts",
        "patch",
        "--firmware",
        firmwarePath,
        "--metadata",
        metadataPath,
        "--program",
        fixturePath("button-display.mcprogram.bin"),
        "--out",
        outPath,
      ],
      { stdio: "pipe" }
    )
  );
});
