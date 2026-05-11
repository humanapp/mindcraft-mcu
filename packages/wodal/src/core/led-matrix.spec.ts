import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEDMatrix } from "./led-matrix";

describe("LEDMatrix", () => {
  it("clamps pixel brightness to uint8 range", () => {
    const matrix = new LEDMatrix();

    matrix.setPixelValue(1, 2, 300);
    matrix.setPixelValue(2, 2, -1);

    assert.equal(matrix.getPixelValue(1, 2), 255);
    assert.equal(matrix.getPixelValue(2, 2), 0);
  });

  it("ignores out-of-range coordinates", () => {
    const matrix = new LEDMatrix();

    matrix.setPixelValue(5, 0, 255);
    matrix.setPixelValue(0, -1, 255);

    assert.equal(
      matrix.snapshot().pixels.reduce((sum, pixel) => sum + pixel, 0),
      0
    );
    assert.equal(matrix.getPixelValue(5, 0), 0);
  });

  it("loads row-major pixel data", () => {
    const matrix = new LEDMatrix();

    matrix.setPixels([1, 2, 3, 4, 5, 6]);

    assert.deepEqual(matrix.snapshot().pixels.slice(0, 6), [1, 2, 3, 4, 5, 6]);
  });
});
