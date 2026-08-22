import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MicroBit } from "@wendoo-lang/wodal/targets/microbit-v2";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SimulatorInstance } from "../services/simulator";
import { TemperatureSlider } from "./TemperatureSlider";

/** Wraps a bare `MicroBit` as the only instance shape the slider reads. */
function instanceWith(microbit: MicroBit): SimulatorInstance {
  return { microbit } as unknown as SimulatorInstance;
}

function renderedRangeValue(instance: SimulatorInstance): string {
  const markup = renderToStaticMarkup(createElement(TemperatureSlider, { instance }));
  const match = markup.match(/data-testid="temperature-slider"[^>]*\bvalue="(-?\d+)"/);
  assert.ok(match, "expected a temperature range input carrying a value");
  return match[1];
}

describe("TemperatureSlider", () => {
  test("a fresh instance seeds the slider at the device default of 21", () => {
    assert.equal(renderedRangeValue(instanceWith(new MicroBit())), "21");
  });

  test("the slider reflects a negative device model temperature", () => {
    const microbit = new MicroBit();
    microbit.setTemperature(-5);
    assert.equal(renderedRangeValue(instanceWith(microbit)), "-5");
  });

  test("the slider reflects the device model's current temperature at the range top", () => {
    const microbit = new MicroBit();
    microbit.setTemperature(50);
    assert.equal(renderedRangeValue(instanceWith(microbit)), "50");
  });
});
