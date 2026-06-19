import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccelerometerGesture, type Sample3D } from "./accelerometer";
import { GestureDetector, recalculatePitchRoll } from "./gesture-detector";

/** Number of stable samples a posture needs before the detector reports it (CODAL gesture damping + 1). */
const POSTURE_PROMOTE_SAMPLES = 6;

/** Feeds the same sample to the detector `times` times and returns the final gesture. */
function feedConstant(detector: GestureDetector, sample: Sample3D, times: number): AccelerometerGesture {
  let gesture = AccelerometerGesture.None;
  for (let i = 0; i < times; i++) {
    gesture = detector.update(sample);
  }
  return gesture;
}

describe("GestureDetector postures", () => {
  const postures: ReadonlyArray<{ name: string; gesture: AccelerometerGesture; across: Sample3D; at: Sample3D }> = [
    {
      name: "tilt left",
      gesture: AccelerometerGesture.TiltLeft,
      across: { x: -801, y: 0, z: 0 },
      at: { x: -800, y: 0, z: 0 },
    },
    {
      name: "tilt right",
      gesture: AccelerometerGesture.TiltRight,
      across: { x: 801, y: 0, z: 0 },
      at: { x: 800, y: 0, z: 0 },
    },
    {
      name: "tilt down",
      gesture: AccelerometerGesture.TiltDown,
      across: { x: 0, y: -801, z: 0 },
      at: { x: 0, y: -800, z: 0 },
    },
    {
      name: "tilt up",
      gesture: AccelerometerGesture.TiltUp,
      across: { x: 0, y: 801, z: 0 },
      at: { x: 0, y: 800, z: 0 },
    },
    {
      name: "face up",
      gesture: AccelerometerGesture.FaceUp,
      across: { x: 0, y: 0, z: -801 },
      at: { x: 0, y: 0, z: -800 },
    },
    {
      name: "face down",
      gesture: AccelerometerGesture.FaceDown,
      across: { x: 0, y: 0, z: 801 },
      at: { x: 0, y: 0, z: 800 },
    },
  ];

  for (const { name, gesture, across, at } of postures) {
    it(`reports ${name} once the axis crosses its tilt threshold`, () => {
      const detector = new GestureDetector();
      assert.equal(feedConstant(detector, across, POSTURE_PROMOTE_SAMPLES), gesture);
    });

    it(`does not report ${name} at the exact tilt threshold`, () => {
      const detector = new GestureDetector();
      assert.equal(feedConstant(detector, at, POSTURE_PROMOTE_SAMPLES), AccelerometerGesture.None);
    });
  }

  it("only promotes a posture after the damping window elapses", () => {
    const detector = new GestureDetector();
    const tiltRight: Sample3D = { x: 1000, y: 0, z: 0 };
    assert.equal(feedConstant(detector, tiltRight, POSTURE_PROMOTE_SAMPLES - 1), AccelerometerGesture.None);
    assert.equal(detector.update(tiltRight), AccelerometerGesture.TiltRight);
  });
});

describe("GestureDetector shake", () => {
  it("reports shake after enough zero crossings on one axis", () => {
    const detector = new GestureDetector();
    const oscillation: readonly Sample3D[] = [
      { x: 600, y: 0, z: 0 },
      { x: -600, y: 0, z: 0 },
      { x: 600, y: 0, z: 0 },
      { x: -600, y: 0, z: 0 },
    ];
    let gesture = AccelerometerGesture.None;
    for (const sample of oscillation) {
      gesture = detector.update(sample);
    }
    assert.equal(gesture, AccelerometerGesture.Shake);
  });

  it("does not report shake for a steady, non-oscillating sample", () => {
    const detector = new GestureDetector();
    assert.equal(feedConstant(detector, { x: 600, y: 0, z: 0 }, POSTURE_PROMOTE_SAMPLES), AccelerometerGesture.None);
  });
});

describe("GestureDetector freefall", () => {
  it("reports freefall for a near-zero magnitude sample", () => {
    const detector = new GestureDetector();
    assert.equal(feedConstant(detector, { x: 0, y: 0, z: 0 }, POSTURE_PROMOTE_SAMPLES), AccelerometerGesture.Freefall);
  });

  it("reports freefall just below the force threshold but not at it", () => {
    const below = new GestureDetector();
    assert.equal(feedConstant(below, { x: 399, y: 0, z: 0 }, POSTURE_PROMOTE_SAMPLES), AccelerometerGesture.Freefall);

    const at = new GestureDetector();
    assert.equal(feedConstant(at, { x: 400, y: 0, z: 0 }, POSTURE_PROMOTE_SAMPLES), AccelerometerGesture.None);
  });
});

describe("GestureDetector reset", () => {
  it("clears posture and shake history", () => {
    const detector = new GestureDetector();
    feedConstant(detector, { x: 1000, y: 0, z: 0 }, POSTURE_PROMOTE_SAMPLES);
    assert.equal(detector.update({ x: 1000, y: 0, z: 0 }), AccelerometerGesture.TiltRight);

    detector.reset();
    assert.equal(detector.update({ x: 1000, y: 0, z: 0 }), AccelerometerGesture.None);
  });
});

describe("recalculatePitchRoll", () => {
  const cases: ReadonlyArray<{ name: string; sample: Sample3D; roll: number; pitch: number }> = [
    { name: "resting face up", sample: { x: 0, y: 0, z: -1000 }, roll: 0, pitch: 0 },
    { name: "rolled fully right", sample: { x: 1000, y: 0, z: 0 }, roll: Math.PI / 2, pitch: 0 },
    { name: "rolled fully left", sample: { x: -1000, y: 0, z: 0 }, roll: -Math.PI / 2, pitch: 0 },
    { name: "z-up quadrant reflection", sample: { x: 0, y: 1000, z: 1000 }, roll: Math.PI, pitch: (3 * Math.PI) / 4 },
  ];

  for (const { name, sample, roll, pitch } of cases) {
    it(`matches CODAL's formula for the ${name} orientation`, () => {
      const result = recalculatePitchRoll(sample);
      assert.ok(Math.abs(result.rollRadians - roll) < 1e-6, `roll ${result.rollRadians} != ${roll}`);
      assert.ok(Math.abs(result.pitchRadians - pitch) < 1e-6, `pitch ${result.pitchRadians} != ${pitch}`);
    });
  }

  it("stores pitch and roll at f32 precision", () => {
    const result = recalculatePitchRoll({ x: 0, y: 1000, z: 1000 });
    assert.equal(Math.fround(result.rollRadians), result.rollRadians);
    assert.equal(Math.fround(result.pitchRadians), result.pitchRadians);
  });
});
