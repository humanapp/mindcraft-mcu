import { FONT_GLYPH_SIZE, fontGlyphRows } from "../../core/bitmap-font";
import { LEDMatrix, type LEDMatrixSnapshot } from "../../core/led-matrix";
import { OperationEnd, type OperationEndListener } from "../../core/operation-end";
import { MICROBIT_LED_MATRIX_SIZE } from "./constants";

/**
 * Blank columns scrolled between consecutive characters, CODAL `DISPLAY_SPACING`.
 * A character occupies the display width plus this spacing before the next.
 */
const SCROLL_DISPLAY_SPACING = 1;

/** Resting ambient light level (0-255) a fresh or reset display reads. */
export const DEFAULT_LIGHT_LEVEL = 128;

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

  /** Invoked once with how the animation ended. */
  readonly onEnd: OperationEndListener;

  /** Steps already rendered to the matrix. */
  steppedCount: number;

  /** Column within the current character cycle, 0..display width plus spacing. */
  scrollingPosition: number;

  /** Index of the character currently scrolling in. */
  scrollingChar: number;
}

/** A static one-character show holding the display lease for its duration. */
interface StaticShow {
  /** Logical tick time at which the show began. */
  readonly startTime: number;

  /** Milliseconds the glyph holds the display before it blanks. */
  readonly durationMs: number;

  /** Invoked once with how the show ended. */
  readonly onEnd: OperationEndListener;
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

  /** Invoked once with how the sequence ended. */
  readonly onEnd: OperationEndListener;

  /** Frames already painted to the matrix (1 after the dispatch paint). */
  paintedCount: number;
}

/** CODAL-style display facade over a 5x5 LED matrix. */
export class MicroBitDisplay {
  /** Matrix backing this display. */
  public readonly matrix = new LEDMatrix(MICROBIT_LED_MATRIX_SIZE, MICROBIT_LED_MATRIX_SIZE);

  /** The scroll animation in progress, or undefined when no scroll holds the display. */
  private activeScroll: ScrollAnimation | undefined;

  /** The static one-character show in progress, or undefined when none holds the display. */
  private activeShow: StaticShow | undefined;

  /** The timed image draw holding the display, or undefined when none does. */
  private activeDraw: DrawLease | undefined;

  /**
   * Ambient light level read off the LED matrix, 0 (dark) to 255 (bright). An
   * independent settable scalar, unrelated to the pixel buffer, resting at
   * {@link DEFAULT_LIGHT_LEVEL} until a host sets it.
   */
  private lightLevel = DEFAULT_LIGHT_LEVEL;

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
   * Starts an asynchronous text show. A text of any length other than one is
   * cleared onto the display and scrolls in from the right: the animation
   * begins at `requestTime`, advances one column step per uniform slice of
   * `durationMs`, and completes after the full duration, when
   * {@link advanceScroll} is next called with a time at or past completion. A
   * one-character text is a static show: its glyph is painted at once, holds
   * the display for the full `durationMs`, and the display blanks at
   * completion - the end state a scroll of the same character leaves. Either
   * rendering holds the display lease for its duration; when the display is
   * already busy (a scroll, a static show, or a timed draw holds the lease)
   * the new request is silently dropped: nothing is shown and `onEnd` fires at
   * once with {@link OperationEnd.Dropped}, so the dispatching fiber continues
   * without blocking.
   *
   * @param text - Text shown on the display.
   * @param durationMs - Hold length in milliseconds.
   * @param requestTime - Logical tick time the show was requested.
   * @param onEnd - Invoked once with how the show ended, at the moment it ends.
   */
  scrollText(text: string, durationMs: number, requestTime: number, onEnd: OperationEndListener): void {
    if (this.isBusy()) {
      onEnd(OperationEnd.Dropped);
      return;
    }
    // Both renderings start from a blank display; any prior content (an
    // earlier draw) is cleared so it does not linger under the show.
    this.matrix.clear();
    if (text.length === 1) {
      this.paintGlyph(text.charCodeAt(0));
      this.activeShow = { startTime: requestTime, durationMs, onEnd };
      return;
    }
    const stepsPerCharacter = this.matrix.width + SCROLL_DISPLAY_SPACING;
    this.activeScroll = {
      text,
      startTime: requestTime,
      durationMs,
      totalSteps: stepsPerCharacter * (text.length + 1),
      onEnd,
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
   * pasted, no lease is taken, and `onEnd` fires at once with
   * {@link OperationEnd.Dropped}. Otherwise the first frame is pasted at once. A
   * positive `perFrameDurationMs` holds the lease until
   * `requestTime + frames.length * perFrameDurationMs`, advancing to the next
   * frame each slice (settled by {@link advanceScroll}); a non-positive
   * `perFrameDurationMs` is fire-and-forget -- only the final frame is pasted, no
   * lease is taken, and the draw ends as completed at once. The pasted image is
   * never cleared; the last frame persists until the next draw.
   *
   * @param frames - Frames shown in order; the caller supplies at least one.
   * @param perFrameDurationMs - Hold per frame in milliseconds; non-positive is fire-and-forget.
   * @param requestTime - Logical tick time the draw was requested.
   * @param onEnd - Invoked once with how the draw ended, at the moment it ends.
   */
  drawImage(
    frames: ReadonlyArray<DisplayFrame>,
    perFrameDurationMs: number,
    requestTime: number,
    onEnd: OperationEndListener
  ): void {
    if (this.isBusy()) {
      onEnd(OperationEnd.Dropped);
      return;
    }
    if (perFrameDurationMs <= 0) {
      // Fire-and-forget: paint only the final frame and take no lease.
      this.paintFrame(frames[frames.length - 1]!);
      onEnd(OperationEnd.Completed);
      return;
    }
    this.paintFrame(frames[0]!);
    this.activeDraw = {
      frames,
      perFrameDurationMs,
      start: requestTime,
      onEnd,
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

  /** True while a scroll, a static show, or a timed draw holds the display lease. */
  isBusy(): boolean {
    return this.activeScroll !== undefined || this.activeShow !== undefined || this.activeDraw !== undefined;
  }

  /**
   * Releases the current display lease at once: the held scroll, static show,
   * or timed draw ends as {@link OperationEnd.Preempted}. A no-op when no lease
   * is held. The display content is left as-is; the next operation overwrites
   * it.
   */
  preempt(): void {
    const scroll = this.activeScroll;
    if (scroll !== undefined) {
      this.activeScroll = undefined;
      scroll.onEnd(OperationEnd.Preempted);
    }
    const show = this.activeShow;
    if (show !== undefined) {
      this.activeShow = undefined;
      show.onEnd(OperationEnd.Preempted);
    }
    const draw = this.activeDraw;
    if (draw !== undefined) {
      this.activeDraw = undefined;
      draw.onEnd(OperationEnd.Preempted);
    }
  }

  /**
   * Advances the active scroll animation to the column step due at `now`,
   * rendering each shifted frame, and completes it (firing `onEnd`) once it
   * has reached its final step. Also advances a timed image-sequence draw to the
   * frame due at `now` and completes it once the whole sequence has elapsed, and
   * completes a static one-character show once its hold has elapsed, blanking
   * the display. This is the per-think display poll: it settles whichever
   * operation holds the lease.
   *
   * @param now - Current logical tick time.
   */
  advanceScroll(now: number): void {
    this.advanceDraw(now);
    this.advanceShow(now);
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
      anim.onEnd(OperationEnd.Completed);
    }
  }

  /** True while a scroll animation is in progress. */
  isScrolling(): boolean {
    return this.activeScroll !== undefined;
  }

  /**
   * Resets the display to its power-on state: blanks the matrix and drops any
   * held scroll, static show, or timed draw without firing its `onEnd`. Call
   * whenever the device timer resets.
   */
  reset(): void {
    this.matrix.clear();
    this.activeScroll = undefined;
    this.activeShow = undefined;
    this.activeDraw = undefined;
    this.lightLevel = DEFAULT_LIGHT_LEVEL;
  }

  /**
   * Advances a timed image-sequence draw to the frame due at `now`, painting
   * each newly-due frame, and completes it (firing `onEnd`) once the whole
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
      draw.onEnd(OperationEnd.Completed);
    }
  }

  /**
   * Completes the static one-character show once its hold has elapsed by `now`:
   * the display blanks and `onEnd` fires.
   */
  private advanceShow(now: number): void {
    const show = this.activeShow;
    if (show === undefined || now < show.startTime + show.durationMs) {
      return;
    }
    this.activeShow = undefined;
    this.matrix.clear();
    show.onEnd(OperationEnd.Completed);
  }

  /**
   * Paints one font glyph over the display top-left, the frame a static CODAL
   * `print(char)` shows. Only lit glyph pixels are written; the caller blanks
   * the display first.
   */
  private paintGlyph(charCode: number): void {
    const rows = fontGlyphRows(charCode);
    for (let y = 0; y < FONT_GLYPH_SIZE; y++) {
      for (let x = 0; x < FONT_GLYPH_SIZE; x++) {
        if (((rows[y] ?? 0) & (1 << (FONT_GLYPH_SIZE - x - 1))) !== 0) {
          this.matrix.setPixelValue(x, y, 255);
        }
      }
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

  /** Reads the ambient light level, 0 (dark) to 255 (bright). */
  getLightLevel(): number {
    return this.lightLevel;
  }

  /**
   * Sets the ambient light level, clamping to 0..255.
   *
   * @param level - Light level; values outside 0..255 are clamped.
   */
  setLightLevel(level: number): void {
    this.lightLevel = Math.max(0, Math.min(255, Math.trunc(level)));
  }

  /**
   * Cancels any held display lease and blanks the matrix. A held scroll, static
   * show, or timed draw is preempted before every pixel is zeroed; a no-op
   * lease-wise when none is held.
   */
  clear(): void {
    this.preempt();
    this.matrix.clear();
  }

  /** Returns a serializable view of the display state. */
  snapshot(): LEDMatrixSnapshot {
    return this.matrix.snapshot();
  }
}
