import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SCROLL_DISPLAY_SPACING,
  SCROLL_DISPLAY_WIDTH,
  SCROLL_STEPS_PER_CHARACTER,
  scrollCompletionTimeMs,
  scrollDurationMs,
  scrollStepCount,
} from "./display-scroll";

/**
 * Independent re-simulation of CODAL `AnimatedDisplay::updateScrollText`,
 * counting how many steps run before `DISPLAY_EVT_ANIMATION_COMPLETE` fires.
 * The closed-form {@link scrollStepCount} must equal this for any text length.
 */
function simulateScrollStepCount(characterCount: number): number {
  const resetPeriod = SCROLL_DISPLAY_WIDTH + SCROLL_DISPLAY_SPACING;
  let scrollingPosition = 0;
  let scrollingChar = 0;
  let steps = 0;
  for (;;) {
    steps++;
    scrollingPosition++;
    if (scrollingPosition === resetPeriod) {
      scrollingPosition = 0;
      if (scrollingChar >= characterCount) {
        return steps;
      }
      scrollingChar++;
    }
  }
}

describe("display scroll completion-time spec", () => {
  test("a character is consumed every display width plus spacing steps", () => {
    assert.equal(SCROLL_STEPS_PER_CHARACTER, 6);
  });

  test("the closed-form step count matches the CODAL stepping simulation", () => {
    for (let length = 0; length <= 16; length++) {
      assert.equal(scrollStepCount(length), simulateScrollStepCount(length));
    }
  });

  test("step count includes the trailing blank clearing cycle", () => {
    assert.equal(scrollStepCount(0), 6);
    assert.equal(scrollStepCount(1), 12);
    assert.equal(scrollStepCount(5), 36);
  });

  test("duration is the step count scaled by the per-step delay", () => {
    assert.equal(scrollDurationMs(5, 120), 36 * 120);
    assert.equal(scrollDurationMs(0, 120), 6 * 120);
    assert.equal(scrollDurationMs(3, 60), scrollStepCount(3) * 60);
  });

  test("completion time offsets the start time by the full duration", () => {
    assert.equal(scrollCompletionTimeMs(0, 5, 120), 36 * 120);
    assert.equal(scrollCompletionTimeMs(1000, 2, 120), 1000 + scrollDurationMs(2, 120));
  });
});
