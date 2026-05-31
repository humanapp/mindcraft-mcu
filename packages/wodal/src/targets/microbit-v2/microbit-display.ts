import { LEDMatrix, type LEDMatrixSnapshot } from "../../core/led-matrix";
import { MICROBIT_LED_MATRIX_SIZE } from "./constants";

/** CODAL-style display facade over a 5x5 LED matrix. */
export class MicroBitDisplay {
  /** Matrix backing this display. */
  public readonly matrix = new LEDMatrix(MICROBIT_LED_MATRIX_SIZE, MICROBIT_LED_MATRIX_SIZE);

  /**
   * Displays a single character or numeric value in the display model.
   *
   * @param value - Value to record on the display.
   * @returns 0 when accepted.
   */
  print(value: string | number): number {
    const text = String(value);
    this.matrix.clear();
    if (text.length > 0) {
      this.matrix.setPixelValue(2, 2, 255);
    }
    return 0;
  }

  /**
   * Records scrolling text in the display model.
   *
   * @param value - Text or number to scroll.
   * @returns 0 when accepted.
   */
  scroll(value: string | number): number {
    return this.print(value);
  }

  /**
   * Sets a pixel brightness.
   *
   * @param x - Zero-based horizontal coordinate.
   * @param y - Zero-based vertical coordinate.
   * @param brightness - Brightness clamped to 0..255.
   */
  setPixelValue(x: number, y: number, brightness: number): void {
    this.matrix.setPixelValue(x, y, brightness);
  }

  /**
   * Reads a pixel brightness.
   *
   * @param x - Zero-based horizontal coordinate.
   * @param y - Zero-based vertical coordinate.
   */
  getPixelValue(x: number, y: number): number {
    return this.matrix.getPixelValue(x, y);
  }

  /** Clears the display. */
  clear(): void {
    this.matrix.clear();
  }

  /** Returns a serializable view of the display state. */
  snapshot(): LEDMatrixSnapshot {
    return this.matrix.snapshot();
  }
}
