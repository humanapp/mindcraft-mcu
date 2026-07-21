import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MicroBit } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SimulatorInstance } from "../services/simulator";
import { LightLevelSlider } from "./LightLevelSlider";

/** Wraps a bare `MicroBit` as the only instance shape the slider reads. */
function instanceWith(microbit: MicroBit): SimulatorInstance {
  return { microbit } as unknown as SimulatorInstance;
}

function renderedRangeValue(instance: SimulatorInstance): string {
  const markup = renderToStaticMarkup(createElement(LightLevelSlider, { instance }));
  const match = markup.match(/data-testid="light-level-slider"[^>]*\bvalue="(\d+)"/);
  assert.ok(match, "expected a light-level range input carrying a value");
  return match[1];
}

describe("LightLevelSlider", () => {
  test("a fresh instance seeds the slider at the device default of 128", () => {
    assert.equal(renderedRangeValue(instanceWith(new MicroBit())), "128");
  });

  test("the slider reflects the device model's current light level", () => {
    const microbit = new MicroBit();
    microbit.setLightLevel(200);
    assert.equal(renderedRangeValue(instanceWith(microbit)), "200");
  });
});
