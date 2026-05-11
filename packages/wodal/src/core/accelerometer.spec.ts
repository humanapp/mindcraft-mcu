import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Accelerometer } from "./accelerometer";

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
});
