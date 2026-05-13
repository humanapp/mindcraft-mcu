import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { coreModule, createMindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { LinkedBrainProgramJson } from "@mindcraft-lang/core/runtime";
import {
  MINDCRAFT_PROGRAM_IMAGE_FORMAT,
  MINDCRAFT_PROGRAM_IMAGE_VERSION,
  MindcraftProgramImageEncoding,
} from "@mindcraft-lang/service-api";
import { WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import {
  parseWodalProgramImage,
  serializeWodalProgramImageJson,
  type WodalProgramImage,
} from "../../../mindcraft/program-image";
import { createMicroBitV2Module } from "./module";
import { WodalMicroBitRuntime } from "./runtime";

const MINIMAL_PROGRAM_FIXTURE_PATH = fileURLToPath(new URL("./__fixtures__/minimal.mcprogram", import.meta.url));

describe("microbit-v2 .mcprogram fixtures", () => {
  it("parses the minimal program image fixture as a microbit-v2 WODAL artifact", () => {
    const content = readFileSync(MINIMAL_PROGRAM_FIXTURE_PATH, "utf8");
    const result = parseWodalProgramImage(content);

    assert.equal(result.ok, true);
    assert.equal(result.encoding, MindcraftProgramImageEncoding.JSON);

    const image = result.image as WodalProgramImage<LinkedBrainProgramJson>;
    assert.equal(image.format, MINDCRAFT_PROGRAM_IMAGE_FORMAT);
    assert.equal(image.version, MINDCRAFT_PROGRAM_IMAGE_VERSION);
    assert.equal(image.profileId, WodalDeviceProfileId.MICROBIT_V2);
    assert.deepEqual(image.program.pages, []);
    assert.deepEqual(image.program.ruleIndex, []);
  });

  it("preserves the fixture profile id across JSON serialization", () => {
    const content = readFileSync(MINIMAL_PROGRAM_FIXTURE_PATH, "utf8");
    const parsed = parseWodalProgramImage(content);
    assert.equal(parsed.ok, true);

    const serialized = serializeWodalProgramImageJson(parsed.image);
    const reparsed = parseWodalProgramImage(serialized);

    assert.equal(reparsed.ok, true);
    assert.equal(reparsed.image.profileId, WodalDeviceProfileId.MICROBIT_V2);
  });

  it("loads the minimal program image fixture through the microbit-v2 runtime", () => {
    const content = readFileSync(MINIMAL_PROGRAM_FIXTURE_PATH, "utf8");
    const parsed = parseWodalProgramImage(content);
    assert.equal(parsed.ok, true);

    const environment = createMindcraftEnvironment({ modules: [coreModule(), createMicroBitV2Module()] });
    const runtime = new WodalMicroBitRuntime({ environment });
    const image = parsed.image as WodalProgramImage<LinkedBrainProgramJson>;

    assert.deepEqual(runtime.loadSerializedWodalProgramImage(image), { ok: true });
    assert.equal(runtime.tick(10), undefined);
    assert.equal(runtime.snapshot().time, 10);
  });
});
