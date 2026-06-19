import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Accelerometer, AccelerometerGesture } from "./accelerometer";

describe("Accelerometer", () => {
  it("normalizes samples to signed 16-bit integer axes", () => {
    const accelerometer = new Accelerometer();

    accelerometer.setSample({ x: 40000, y: -40000, z: 10.9 });

    assert.deepEqual(accelerometer.getSample(), { x: 32767, y: -32768, z: 10 });
  });

  it("normalizes configuration and gesture values", () => {
    const accelerometer = new Accelerometer();

    assert.equal(accelerometer.setPeriod(12.9), 0);
    assert.equal(accelerometer.getPeriod(), 12);
    assert.equal(accelerometer.setRange(8.9), 0);
    assert.equal(accelerometer.getRange(), 8);
    assert.equal(accelerometer.setPeriod(0), -1);
    assert.equal(accelerometer.setRange(-1), -1);

    accelerometer.setGesture(4294967295);
    assert.equal(accelerometer.getGesture(), -1);
  });

  it("derives gesture, axes, and radians from fed motion samples", () => {
    const accelerometer = new Accelerometer();
    const tiltRight = { x: 1000, y: 0, z: 0 };

    // The gesture filter promotes a sustained posture only after its damping window.
    for (let i = 0; i < 6; i++) {
      accelerometer.feedSample(tiltRight);
    }

    assert.equal(accelerometer.getGesture(), AccelerometerGesture.TiltRight);
    assert.deepEqual(accelerometer.getSample(), tiltRight);
    assert.ok(Math.abs(accelerometer.getRollRadians() - Math.PI / 2) < 1e-6);
    assert.ok(Math.abs(accelerometer.getPitchRadians()) < 1e-6);
    assert.equal(accelerometer.getPitch(), 0);
  });

  it("keeps explicit gesture injection independent of the detector feed", () => {
    const accelerometer = new Accelerometer();

    for (let i = 0; i < 6; i++) {
      accelerometer.feedSample({ x: 1000, y: 0, z: 0 });
    }
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.TiltRight);

    accelerometer.setGesture(AccelerometerGesture.None);
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.None);
  });
});
