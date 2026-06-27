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

/** A single draw frame: packed brightness bytes plus its size, already clipped to the display. */
export interface DisplayFrame {
  /** Brightness bytes, row-major, length `width * height`. */
  readonly frame: ReadonlyArray<number>;

  /** Frame width in columns, at most the display width. */
  readonly width: number;

  /** Frame height in rows, at most the display height. */
  readonly height: number;
}

/**
 * A timed image-sequence draw holding the display lease. Each frame is shown for
 * {@link perFrameDurationMs}; the lease elapses after the whole sequence.
 */
interface DrawLease {
  /** Frames shown in order, one per {@link perFrameDurationMs} slice. */
  readonly frames: ReadonlyArray<DisplayFrame>;

  /** Milliseconds each frame holds the display before the next is shown. */
  readonly perFrameDurationMs: number;

  /** Logical tick time at which the sequence began (frame 0 painted). */
  readonly start: number;

  /** Invoked once when the whole sequence elapses. */
  readonly onComplete: () => void;

  /** Frames already painted to the matrix (1 after the dispatch paint). */
  paintedCount: number;
}

/** CODAL-style display facade over a 5x5 LED matrix. */
export class MicroBitDisplay {
  /** Matrix backing this display. */
  public readonly matrix = new LEDMatrix(MICROBIT_LED_MATRIX_SIZE, MICROBIT_LED_MATRIX_SIZE);

  /** The scroll animation in progress, or undefined when no scroll holds the display. */
  private activeScroll: ScrollAnimation | undefined;

  /** The timed image draw holding the display, or undefined when none does. */
  private activeDraw: DrawLease | undefined;

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
   * Starts an asynchronous text scroll. The display is cleared and the text
   * scrolls in from the right. The animation begins at `requestTime`, advances
   * one column step per uniform slice of `durationMs`, and completes after the
   * full duration, when {@link advanceScroll} is next called with a time at or
   * past completion. The scroll holds the display lease for its
   * duration; when the display is already busy (a scroll or a timed draw holds
   * the lease) the new scroll is silently dropped: nothing is shown and
   * `onComplete` fires at once, so the dispatching fiber continues without
   * blocking.
   *
   * @param text - Text shown on the display.
   * @param durationMs - Animation length in milliseconds.
   * @param requestTime - Logical tick time the scroll was requested.
   * @param onComplete - Invoked once when the animation completes (or at once when dropped).
   */
  scrollText(text: string, durationMs: number, requestTime: number, onComplete: () => void): void {
    if (this.isBusy()) {
      onComplete();
      return;
    }
    // The text scrolls in from a blank display; any prior content (an earlier
    // draw) is cleared so it does not shift through the animation.
    this.matrix.clear();
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
   * Pastes a sequence of image frames onto the display top-left, one frame per
   * `perFrameDurationMs` slice, holding the display lease for the whole
   * sequence. Each frame is packed brightness bytes, row-major, already clipped
   * to the display by the caller. When the display is already busy (a scroll or
   * a timed draw holds the lease) the draw is silently dropped: nothing is
   * pasted, no lease is taken, and `onComplete` fires at once. Otherwise the
   * first frame is pasted at once. A positive `perFrameDurationMs` holds the
   * lease until `requestTime + frames.length * perFrameDurationMs`, advancing to
   * the next frame each slice (settled by {@link advanceScroll}); a non-positive
   * `perFrameDurationMs` is fire-and-forget -- only the final frame is pasted, no
   * lease is taken, and `onComplete` fires at once. The pasted image is never
   * cleared; the last frame persists until the next draw.
   *
   * @param frames - Frames shown in order; the caller supplies at least one.
   * @param perFrameDurationMs - Hold per frame in milliseconds; non-positive is fire-and-forget.
   * @param requestTime - Logical tick time the draw was requested.
   * @param onComplete - Invoked once when the sequence elapses (or at once when dropped or untimed).
   */
  drawImage(
    frames: ReadonlyArray<DisplayFrame>,
    perFrameDurationMs: number,
    requestTime: number,
    onComplete: () => void
  ): void {
    if (this.isBusy()) {
      onComplete();
      return;
    }
    if (perFrameDurationMs <= 0) {
      // Fire-and-forget: paint only the final frame and take no lease.
      this.paintFrame(frames[frames.length - 1]!);
      onComplete();
      return;
    }
    this.paintFrame(frames[0]!);
    this.activeDraw = {
      frames,
      perFrameDurationMs,
      start: requestTime,
      onComplete,
      paintedCount: 1,
    };
  }

  /**
   * Pastes one frame onto the display top-left, row-major, brightness wrapped to
   * a byte. The frame's own width is its row stride.
   *
   * @param image - Frame to paste, already clipped to the display.
   */
  paintFrame(image: DisplayFrame): void {
    for (let row = 0; row < image.height; row++) {
      for (let col = 0; col < image.width; col++) {
        this.matrix.setPixelValue(col, row, (image.frame[row * image.width + col] ?? 0) & 0xff);
      }
    }
  }

  /** True while a scroll or a timed draw holds the display lease. */
  isBusy(): boolean {
    return this.activeScroll !== undefined || this.activeDraw !== undefined;
  }

  /**
   * Releases the current display lease at once: the held scroll or timed draw is
   * dropped and its handle resolved, so its awaiting rule resumes as if the
   * operation finished. A no-op when no lease is held. The display content is
   * left as-is; the next operation overwrites it.
   */
  preempt(): void {
    const scroll = this.activeScroll;
    if (scroll !== undefined) {
      this.activeScroll = undefined;
      scroll.onComplete();
    }
    const draw = this.activeDraw;
    if (draw !== undefined) {
      this.activeDraw = undefined;
      draw.onComplete();
    }
  }

  /**
   * Advances the active scroll animation to the column step due at `now`,
   * rendering each shifted frame, and completes it (firing `onComplete`) once it
   * has reached its final step. Also advances a timed image-sequence draw to the
   * frame due at `now` and completes it (firing its `onComplete`) once the whole
   * sequence has elapsed. This is the per-think display poll: it advances and
   * resolves a timed draw holding the lease, and steps and completes the scroll
   * animation.
   *
   * @param now - Current logical tick time.
   */
  advanceScroll(now: number): void {
    this.advanceDraw(now);
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
    this.activeDraw = undefined;
  }

  /**
   * Advances a timed image-sequence draw to the frame due at `now`, painting
   * each newly-due frame, and completes it (firing `onComplete`) once the whole
   * sequence has elapsed by `now`. The frame index due at `now` is
   * `min(floor((now - start) / perFrameDurationMs), frameCount - 1)`; the last
   * frame persists after completion.
   */
  private advanceDraw(now: number): void {
    const draw = this.activeDraw;
    if (draw === undefined) {
      return;
    }
    const frameCount = draw.frames.length;
    const targetIndex = Math.min(Math.floor((now - draw.start) / draw.perFrameDurationMs), frameCount - 1);
    while (draw.paintedCount <= targetIndex) {
      this.paintFrame(draw.frames[draw.paintedCount]!);
      draw.paintedCount++;
    }
    if (now >= draw.start + frameCount * draw.perFrameDurationMs) {
      this.activeDraw = undefined;
      draw.onComplete();
    }
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
