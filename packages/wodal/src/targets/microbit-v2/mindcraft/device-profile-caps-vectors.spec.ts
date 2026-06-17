import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";

// -- Scheduler/resource cap parity fixture for the C++ gate -------------------
//
// Emits the microbit-v2 device profile's scheduling and per-fiber resource caps
// as a golden byte table. cpp/test/scheduler-caps-parity.test.cpp decodes each
// (name, value) pair and asserts the C++ kMicroBitV2SchedulerCaps field of that
// name equals it, so a one-sided change to either the profile or the C++ caps
// fails the gate. The encoding is:
//   magic 'M' 'C' 'C' '1' | varuint count | count * (varuint nameLen, name
//   bytes, varuint value)
// maxHandles is the eighth cap: the concurrent async-handle ceiling, mirrored
// by the C++ maxHandles device-profile guard.

const FIXTURE = fileURLToPath(new URL("./__fixtures__/device-profile-caps-vectors.bin", import.meta.url));

const profile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);

/** The caps the gate covers, in emission order, paired with their profile values. */
const CAPS: ReadonlyArray<readonly [string, number]> = [
  ["defaultBudget", profile.defaultBudget],
  ["hookBudget", profile.hookBudget],
  ["maxFibers", profile.maxFibers],
  ["maxStackSize", profile.maxStackSize],
  ["maxLocalsSize", profile.maxLocalsSize],
  ["maxFrameDepth", profile.maxFrameDepth],
  ["maxHandlers", profile.maxHandlers],
  ["maxHandles", profile.maxHandles],
];

class ByteWriter {
  readonly bytes: number[] = [];
  u8(b: number): void {
    this.bytes.push(b & 0xff);
  }
  varuint(n: number): void {
    let v = n >>> 0;
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.u8(v);
  }
  str(s: string): void {
    const buf = Buffer.from(s, "utf8");
    this.varuint(buf.length);
    for (const b of buf) {
      this.u8(b);
    }
  }
}

const writer = new ByteWriter();
writer.u8(0x4d); // 'M'
writer.u8(0x43); // 'C'
writer.u8(0x43); // 'C'
writer.u8(0x31); // '1'
writer.varuint(CAPS.length);
for (const [name, value] of CAPS) {
  writer.str(name);
  writer.varuint(value);
}
const fixture = Buffer.from(writer.bytes);

describe("device profile cap parity vectors", () => {
  test("emit a stable golden cap table for the C++ gate", () => {
    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, fixture);
    }
    const committed = readFileSync(FIXTURE);
    assert.ok(
      committed.equals(fixture),
      `device-profile-caps-vectors.bin is stale; delete ${FIXTURE} and re-run to regenerate`
    );
  });
});
