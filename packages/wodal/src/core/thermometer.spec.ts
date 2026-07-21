import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TEMPERATURE, Thermometer } from "./thermometer";

describe("Thermometer", () => {
  it("rests at the default reading", () => {
    assert.equal(DEFAULT_TEMPERATURE, 21);
    const thermometer = new Thermometer();
    assert.equal(thermometer.getTemperature(), 21);
  });

  it("holds a set reading", () => {
    const thermometer = new Thermometer();
    thermometer.setTemperature(30);
    assert.equal(thermometer.getTemperature(), 30);
  });

  it("preserves a negative signed reading without clamping", () => {
    const thermometer = new Thermometer();
    thermometer.setTemperature(-10);
    assert.equal(thermometer.getTemperature(), -10);
  });

  it("truncates a fractional reading toward zero", () => {
    const thermometer = new Thermometer();
    thermometer.setTemperature(21.9);
    assert.equal(thermometer.getTemperature(), 21);
    thermometer.setTemperature(-3.9);
    assert.equal(thermometer.getTemperature(), -3);
  });

  it("resets to the default reading", () => {
    const thermometer = new Thermometer();
    thermometer.setTemperature(45);
    thermometer.reset();
    assert.equal(thermometer.getTemperature(), 21);
  });
});
