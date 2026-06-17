import { FONT_GLYPH_SIZE, fontGlyphRows } from "../../core/bitmap-font";
import { LEDMatrix, type LEDMatrixSnapshot } from "../../core/led-matrix";
import { MICROBIT_LED_MATRIX_SIZE } from "./constants";

/**
 * Blank columns scrolled between consecutive characters, CODAL `DISPLAY_SPACING`.
 * A character occupies the display width plus this spacing before the next.
 */
const SCROLL_DISPLAY_SPACING = 1;

/** The scroll animation in progress, rendered step by step over its duration. */
interface ScrollAnimation {
  /** Text being scrolled. */
  readonly text: string;

  /** Logical tick time at which the animation began. */
  readonly startTime: number;

  /** Total animation length in milliseconds. */
  readonly durationMs: number;

  /** Total number of column-shift steps before completion. */
  readonly totalSteps: number;

  /** Invoked once when the animation completes. */
  readonly onComplete: () => void;

  /** Steps already rendered to the matrix. */
  steppedCount: number;

  /** Column within the current character cycle, 0..display width plus spacing. */
  scrollingPosition: number;

  /** Index of the character currently scrolling in. */
  scrollingChar: number;
}

/** CODAL-style display facade over a 5x5 LED matrix. */
export class MicroBitDisplay {
  /** Matrix backing this display. */
  public readonly matrix = new LEDMatrix(MICROBIT_LED_MATRIX_SIZE, MICROBIT_LED_MATRIX_SIZE);

  /** The scroll animation in progress, or undefined when the display is free. */
  private activeScroll: ScrollAnimation | undefined;

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
   * Starts an asynchronous text scroll. The animation begins at `requestTime`,
   * advances one column step per uniform slice of `durationMs`, and completes
   * after the full duration, when {@link advanceScroll} is next called with a
   * time at or past completion. When a scroll is already in progress the new one
   * is rejected: `onComplete` fires immediately and nothing else changes.
   *
   * @param text - Text shown on the display.
   * @param durationMs - Animation length in milliseconds.
   * @param requestTime - Logical tick time the scroll was requested.
   * @param onComplete - Invoked once when the animation completes (or at once when rejected).
   */
  scrollText(text: string, durationMs: number, requestTime: number, onComplete: () => void): void {
    if (this.activeScroll !== undefined) {
      onComplete();
      return;
    }
    const stepsPerCharacter = this.matrix.width + SCROLL_DISPLAY_SPACING;
    this.activeScroll = {
      text,
      startTime: requestTime,
      durationMs,
      totalSteps: stepsPerCharacter * (text.length + 1),
      onComplete,
      steppedCount: 0,
      scrollingPosition: 0,
      scrollingChar: 0,
    };
  }

  /**
   * Advances the active scroll animation to the column step due at `now`,
   * rendering each shifted frame, and completes it (firing `onComplete`) once it
   * has reached its final step.
   *
   * @param now - Current logical tick time.
   */
  advanceScroll(now: number): void {
    const anim = this.activeScroll;
    if (anim === undefined) {
      return;
    }
    const targetStep =
      anim.durationMs <= 0
        ? now >= anim.startTime
          ? anim.totalSteps
          : 0
        : now <= anim.startTime
          ? 0
          : Math.min(anim.totalSteps, Math.floor(((now - anim.startTime) * anim.totalSteps) / anim.durationMs));
    while (anim.steppedCount < targetStep) {
      this.stepScroll(anim);
      anim.steppedCount++;
    }
    if (anim.steppedCount >= anim.totalSteps) {
      this.activeScroll = undefined;
      anim.onComplete();
    }
  }

  /** True while a scroll animation is in progress. */
  isScrolling(): boolean {
    return this.activeScroll !== undefined;
  }

  /**
   * Resets the display to its power-on state: blanks the matrix and drops the
   * scroll in progress. Call whenever the device timer resets.
   */
  reset(): void {
    this.clear();
    this.activeScroll = undefined;
  }

  /**
   * Renders one CODAL `updateScrollText` step into the matrix: shift the image
   * left one column, paste the next glyph column into the rightmost column when
   * one is due, and advance the character cycle.
   */
  private stepScroll(anim: ScrollAnimation): void {
    this.shiftLeftColumns();
    if (anim.scrollingPosition < FONT_GLYPH_SIZE && anim.scrollingChar < anim.text.length) {
      const rows = fontGlyphRows(anim.text.charCodeAt(anim.scrollingChar));
      const mask = 1 << (FONT_GLYPH_SIZE - anim.scrollingPosition - 1);
      const x = this.matrix.width - 1;
      for (let y = 0; y < FONT_GLYPH_SIZE; y++) {
        if (((rows[y] ?? 0) & mask) !== 0) {
          this.matrix.setPixelValue(x, y, 255);
        }
      }
    }
    anim.scrollingPosition++;
    if (anim.scrollingPosition === this.matrix.width + SCROLL_DISPLAY_SPACING) {
      anim.scrollingPosition = 0;
      anim.scrollingChar++;
    }
  }

  /** Shifts every matrix row one column to the left, clearing the rightmost column. */
  private shiftLeftColumns(): void {
    for (let y = 0; y < this.matrix.height; y++) {
      for (let x = 0; x < this.matrix.width - 1; x++) {
        this.matrix.setPixelValue(x, y, this.matrix.getPixelValue(x + 1, y));
      }
      this.matrix.setPixelValue(this.matrix.width - 1, y, 0);
    }
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
