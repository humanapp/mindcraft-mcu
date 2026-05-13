import { clampUint8, type Uint8 } from "./numeric";

/** Brightness value for one LED matrix pixel in the range 0..255. */
export type LedBrightness = Uint8;

/** Serializable state of a 5x5 LED matrix. */
export interface LEDMatrixSnapshot {
  /** Matrix width in pixels. */
  readonly width: number;

  /** Matrix height in pixels. */
  readonly height: number;

  /** Row-major pixel brightness values in the range 0..255. */
  readonly pixels: readonly number[];
}

/** Software representation of an LED matrix. */
export class LEDMatrix {
  private readonly pixels: Uint8Array;

  /** Matrix width in pixels. */
  readonly width: number;

  /** Matrix height in pixels. */
  readonly height: number;

  /**
   * Creates an LED matrix.
   *
   * @param width - Matrix width in pixels.
   * @param height - Matrix height in pixels.
   */
  constructor(width: number, height: number) {
    this.width = Math.max(0, Math.trunc(width));
    this.height = Math.max(0, Math.trunc(height));
    this.pixels = new Uint8Array(this.width * this.height);
  }

  /**
   * Sets a pixel brightness.
   *
   * @param x - Zero-based horizontal coordinate.
   * @param y - Zero-based vertical coordinate.
   * @param brightness - Brightness clamped to 0..255.
   */
  setPixelValue(x: number, y: number, brightness: number): void {
    if (!this.contains(x, y)) {
      return;
    }
    this.pixels[this.index(x, y)] = clampUint8(brightness);
  }

  /**
   * Reads a pixel brightness.
   *
   * @param x - Zero-based horizontal coordinate.
   * @param y - Zero-based vertical coordinate.
   * @returns Brightness in the range 0..255, or 0 for out-of-range coordinates.
   */
  getPixelValue(x: number, y: number): number {
    if (!this.contains(x, y)) {
      return 0;
    }
    return this.pixels[this.index(x, y)] ?? 0;
  }

  /**
   * Sets all pixels from row-major brightness data.
   *
   * @param pixels - Up to 25 row-major brightness values.
   */
  setPixels(pixels: Iterable<number>): void {
    let index = 0;
    for (const brightness of pixels) {
      if (index >= this.pixels.length) {
        break;
      }
      this.pixels[index] = clampUint8(brightness);
      index++;
    }
  }

  /** Clears all pixels. */
  clear(): void {
    this.pixels.fill(0);
  }

  /** Returns a serializable view of the matrix state. */
  snapshot(): LEDMatrixSnapshot {
    return {
      width: this.width,
      height: this.height,
      pixels: Array.from(this.pixels),
    };
  }

  private contains(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }
}
