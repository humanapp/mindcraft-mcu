/**
 * Pinned scroll completion-time spec for the microbit-v2 display.
 *
 * `display.scroll(text)` is an asynchronous host action: the calling fiber
 * awaits a handle that resolves when the scroll animation completes. The
 * resolve round is a deterministic function of the text, the per-step delay,
 * and the display geometry; both the WODAL oracle and the C++ microbit-v2 port
 * compute it from the constants and formulas here, and the observable-trace
 * goldens enforce the match. The timing is target-specific.
 *
 * The model mirrors CODAL `AnimatedDisplay::scrollAsync` /
 * `updateScrollText` (vendored under
 * cpp/targets/microbit-v2/libraries/codal-core). The animation advances one
 * step every `animationDelay` ms. Each step shifts the image left one column;
 * a character occupies {@link SCROLL_DISPLAY_WIDTH} columns plus
 * {@link SCROLL_DISPLAY_SPACING} blank column before the next, so a character
 * is consumed every {@link SCROLL_STEPS_PER_CHARACTER} steps. After the last
 * character is consumed, one further blank cycle of the same width clears it
 * off the display, then `DISPLAY_EVT_ANIMATION_COMPLETE` fires. The total step
 * count is therefore {@link SCROLL_STEPS_PER_CHARACTER} times
 * `(characterCount + 1)`, and completion lands at the start time plus that many
 * step delays.
 *
 * The character count is the text's UTF-16 code-unit length, matching CODAL
 * `ManagedString::length()` for the ASCII text the scroll action accepts.
 *
 * A one-character text renders as a static show instead of scrolling; it holds
 * the display for the same completion time this formula gives one character.
 */

/** Display matrix width in columns, CODAL `Display::getWidth()` for the 5x5 matrix. */
export const SCROLL_DISPLAY_WIDTH = 5;

/** Blank columns inserted between consecutive characters, CODAL `DISPLAY_SPACING`. */
export const SCROLL_DISPLAY_SPACING = 1;

/** Default per-step delay in milliseconds, CODAL `DISPLAY_DEFAULT_SCROLL_SPEED`. */
export const SCROLL_DEFAULT_DELAY_MS = 120;

/**
 * Animation steps to scroll one character fully off the display:
 * {@link SCROLL_DISPLAY_WIDTH} visible columns plus
 * {@link SCROLL_DISPLAY_SPACING} trailing blank column. This is CODAL's
 * `display.getWidth() + DISPLAY_SPACING` reset period in `updateScrollText`.
 */
export const SCROLL_STEPS_PER_CHARACTER = SCROLL_DISPLAY_WIDTH + SCROLL_DISPLAY_SPACING;

/**
 * Number of animation steps a scroll of `characterCount` characters runs before
 * completion, including the trailing blank cycle that clears the final
 * character. `characterCount` must be a non-negative integer.
 */
export function scrollStepCount(characterCount: number): number {
  return SCROLL_STEPS_PER_CHARACTER * (characterCount + 1);
}

/**
 * Elapsed milliseconds from a scroll's start to its completion, for a text of
 * `characterCount` characters animated at `delayMs` per step. `characterCount`
 * must be a non-negative integer and `delayMs` a positive number.
 */
export function scrollDurationMs(characterCount: number, delayMs: number): number {
  return scrollStepCount(characterCount) * delayMs;
}

/**
 * The logical tick time at which a scroll's handle resolves: the time the scroll
 * started plus its full duration. The awaiting fiber resumes on the first think
 * whose context time is at or past this value. `startTimeMs` is the context time
 * of the think that started the scroll; `characterCount` and `delayMs` follow
 * {@link scrollDurationMs}.
 */
export function scrollCompletionTimeMs(startTimeMs: number, characterCount: number, delayMs: number): number {
  return startTimeMs + scrollDurationMs(characterCount, delayMs);
}
