import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { Accelerometer, AccelerometerGesture } from "../../../core/accelerometer";

// -- Accelerometer port read-back parity fixture for the C++ gate -------------
//
// Drives a scripted injection schedule through the accelerometer port and emits
// the per-tick read-back as a golden byte table. Each tick applies an optional
// setpoint (a held value persists until a later tick changes it) and then reads
// the eight port methods. cpp/test/accelerometer-read-parity.test.cpp replays
// the same schedule against its host stub and byte-matches this golden, proving
// the held-value semantics agree across the two VMs. The encoding is:
//   magic 'M' 'A' 'V' '1' | varuint tickCount | tickCount * (
//     u8 setMask                       // bit0 gesture, bit1 sample, bit2 pitch, bit3 roll
//     [i32 gesture]                    // when bit0 set
//     [i32 x, i32 y, i32 z]            // when bit1 set
//     [f32 pitchRadians]               // when bit2 set
//     [f32 rollRadians]                // when bit3 set
//     // read-back:
//     i32 gesture, i32 x, i32 y, i32 z,
//     i32 pitchDegrees, f32 pitchRadians, i32 rollDegrees, f32 rollRadians
//   )
// Acceleration setpoints stay within the signed 16-bit range the port stores,
// so neither VM clamps and the read-back equals the setpoint exactly. Radians
// are the primary orientation reading; degrees are derived from them with
// CODAL's exact f32 formula, so both VMs derive identical whole-degree values.

const FIXTURE = fileURLToPath(new URL("./__fixtures__/accelerometer-read-vectors.bin", import.meta.url));

const SET_GESTURE = 1 << 0;
const SET_SAMPLE = 1 << 1;
const SET_PITCH = 1 << 2;
const SET_ROLL = 1 << 3;

/** One scheduled tick: the optional setpoints applied before the read-back. */
interface ScheduleStep {
  readonly gesture?: AccelerometerGesture;
  readonly sample?: { readonly x: number; readonly y: number; readonly z: number };
  readonly pitchRadians?: number;
  readonly rollRadians?: number;
}

/**
 * The injection schedule. Ticks with no setpoint (ticks 2, 5, 9) prove every
 * reading holds its last value; partial setpoints prove the unmentioned
 * readings hold while one changes.
 */
const SCHEDULE: ReadonlyArray<ScheduleStep> = [
  { gesture: AccelerometerGesture.None, sample: { x: 0, y: 0, z: -1000 }, pitchRadians: 0, rollRadians: 0 },
  { gesture: AccelerometerGesture.Shake },
  {},
  { sample: { x: 1024, y: -512, z: 0 } },
  { gesture: AccelerometerGesture.TiltLeft, pitchRadians: Math.PI / 4, rollRadians: -Math.PI / 6 },
  { gesture: AccelerometerGesture.None },
  { gesture: AccelerometerGesture.Freefall, sample: { x: 0, y: 0, z: 0 } },
  { gesture: AccelerometerGesture.Impact2G },
  {
    gesture: AccelerometerGesture.Impact8G,
    sample: { x: -2000, y: 2000, z: 1000 },
    pitchRadians: Math.PI / 2,
    rollRadians: Math.PI,
  },
  {},
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
  i32(n: number): void {
    let v = n | 0;
    for (let i = 0; i < 4; i++) {
      this.u8(v & 0xff);
      v >>= 8;
    }
  }
  f32(n: number): void {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, Math.fround(n), true);
    for (let i = 0; i < 4; i++) {
      this.u8(dv.getUint8(i));
    }
  }
}

function buildFixture(): Buffer {
  const accelerometer = new Accelerometer();
  const writer = new ByteWriter();
  writer.u8(0x4d); // 'M'
  writer.u8(0x41); // 'A'
  writer.u8(0x56); // 'V'
  writer.u8(0x31); // '1'
  writer.varuint(SCHEDULE.length);

  for (const step of SCHEDULE) {
    let mask = 0;
    if (step.gesture !== undefined) {
      mask |= SET_GESTURE;
    }
    if (step.sample !== undefined) {
      mask |= SET_SAMPLE;
    }
    if (step.pitchRadians !== undefined) {
      mask |= SET_PITCH;
    }
    if (step.rollRadians !== undefined) {
      mask |= SET_ROLL;
    }
    writer.u8(mask);

    if (step.gesture !== undefined) {
      accelerometer.setGesture(step.gesture);
      writer.i32(step.gesture);
    }
    if (step.sample !== undefined) {
      accelerometer.setSample(step.sample);
      writer.i32(step.sample.x);
      writer.i32(step.sample.y);
      writer.i32(step.sample.z);
    }
    if (step.pitchRadians !== undefined) {
      accelerometer.setPitchRadians(step.pitchRadians);
      writer.f32(accelerometer.getPitchRadians());
    }
    if (step.rollRadians !== undefined) {
      accelerometer.setRollRadians(step.rollRadians);
      writer.f32(accelerometer.getRollRadians());
    }

    writer.i32(accelerometer.getGesture());
    writer.i32(accelerometer.getX());
    writer.i32(accelerometer.getY());
    writer.i32(accelerometer.getZ());
    writer.i32(accelerometer.getPitch());
    writer.f32(accelerometer.getPitchRadians());
    writer.i32(accelerometer.getRoll());
    writer.f32(accelerometer.getRollRadians());
  }

  return Buffer.from(writer.bytes);
}

describe("accelerometer port read-back parity vectors", () => {
  test("emit a stable golden read-back table for the C++ gate", () => {
    const fixture = buildFixture();
    if (!existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, fixture);
    }
    const committed = readFileSync(FIXTURE);
    assert.ok(
      committed.equals(fixture),
      `accelerometer-read-vectors.bin is stale; delete ${FIXTURE} and re-run to regenerate`
    );
  });

  test("a held value persists until the schedule changes it", () => {
    const accelerometer = new Accelerometer();
    accelerometer.setGesture(AccelerometerGesture.Shake);
    accelerometer.setSample({ x: 100, y: 200, z: 300 });
    accelerometer.setPitchRadians(Math.PI / 12);
    accelerometer.setRollRadians(-Math.PI / 12);
    const heldPitch = accelerometer.getPitch();

    // No new setpoint: every reading holds across reads.
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.Shake);
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.Shake);
    assert.equal(accelerometer.getX(), 100);
    assert.equal(accelerometer.getPitchRadians(), Math.fround(Math.PI / 12));
    assert.equal(accelerometer.getRollRadians(), Math.fround(-Math.PI / 12));
    // Degrees derive from the held radian reading and stay stable across reads.
    assert.equal(accelerometer.getPitch(), heldPitch);

    accelerometer.setGesture(AccelerometerGesture.None);
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.None);
    // The acceleration and orientation hold when only the gesture changes.
    assert.equal(accelerometer.getX(), 100);
    assert.equal(accelerometer.getZ(), 300);
    assert.equal(accelerometer.getPitchRadians(), Math.fround(Math.PI / 12));
    assert.equal(accelerometer.getPitch(), heldPitch);
  });
});
