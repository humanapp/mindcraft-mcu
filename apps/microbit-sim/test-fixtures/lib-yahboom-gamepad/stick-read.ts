import type { Context } from "wendoo";

/**
 * The Yahboom GHBit gamepad reads its controls off the mounted micro:bit's edge
 * pins: the thumb stick as two analog axes, its press and the four colored
 * buttons as pull-up digital lines. This module owns every raw read and the
 * raw-to-game transform, so the vendor's pin assignment and electrical
 * convention never leak past it - every downstream tile sees game convention
 * (`x` right-positive, `y` up-positive, both -100..100) only.
 */

/** Analog pin for the vertical stick axis; reads LOW toward up. */
const VERTICAL_PIN = 1;
/** Analog pin for the horizontal stick axis; reads LOW toward right. */
const HORIZONTAL_PIN = 2;
/** Digital pin for the stick press; pull-up, LOW while pressed. */
const PRESS_PIN = 8;

/** Digital pin for button B1 (red); pull-up, LOW while pressed. */
export const BUTTON_RED_PIN = 13;
/** Digital pin for button B2 (green); pull-up, LOW while pressed. */
export const BUTTON_GREEN_PIN = 14;
/** Digital pin for button B3 (blue); pull-up, LOW while pressed. */
export const BUTTON_BLUE_PIN = 15;
/** Digital pin for button B4 (yellow); pull-up, LOW while pressed. */
export const BUTTON_YELLOW_PIN = 16;

/** `setPull` mode selecting the internal pull-up a button/press line needs. */
const PULL_UP = 1;

/** Rest (centered) raw reading of the vertical axis, measured on the v1.2 handle. */
const VERTICAL_REST = 500;
/** Raw span from rest to full up (raw 0). */
const VERTICAL_UP_SPAN = 500;
/** Raw span from rest to full down (raw 1018). */
const VERTICAL_DOWN_SPAN = 518;

/** Rest (centered) raw reading of the horizontal axis, measured on the v1.2 handle. */
const HORIZONTAL_REST = 502;
/** Raw span from rest to full right (raw 0). */
const HORIZONTAL_RIGHT_SPAN = 502;
/** Raw span from rest to full left (raw 1023). */
const HORIZONTAL_LEFT_SPAN = 521;

/**
 * Half-width (in raw counts) of the centered dead band on each axis. Offsets
 * within it read as exactly 0; the live band above it is rescaled so the output
 * rises smoothly from 0 at the edge to full deflection.
 */
const DEADZONE = 50;

/**
 * Raw reading below which an axis counts as deflected toward its LOW direction
 * (up / right), for the discrete direction tiles. Wider than {@link DEADZONE}:
 * the direction band is the vendor's coarse thresholded state, distinct from the
 * continuous position dead band.
 */
const DIRECTION_LOW = 200;
/** Raw reading above which an axis counts as deflected toward its HIGH direction (down / left). */
const DIRECTION_HIGH = 730;

/** Direction label for a stick pushed up. */
export const DIRECTION_UP = "up";
/** Direction label for a stick pushed down. */
export const DIRECTION_DOWN = "down";
/** Direction label for a stick pushed left. */
export const DIRECTION_LEFT = "left";
/** Direction label for a stick pushed right. */
export const DIRECTION_RIGHT = "right";
/** Direction label for a centered or pressed stick. */
export const DIRECTION_NONE = "none";

/**
 * Reads the raw vertical axis (analog pin 1) as the ADC delivers it, 0-1023.
 * Exposed for power users who want the unprocessed reading; the direction and
 * position tiles work in game convention instead.
 */
export function readVerticalRaw(ctx: Context): number {
  return ctx.microbit.gpio.analogRead(VERTICAL_PIN);
}

/**
 * Reads the raw horizontal axis (analog pin 2) as the ADC delivers it, 0-1023.
 * Exposed for power users; the direction and position tiles work in game
 * convention instead.
 */
export function readHorizontalRaw(ctx: Context): number {
  return ctx.microbit.gpio.analogRead(HORIZONTAL_PIN);
}

/**
 * Maps a raw axis reading to a centered, normalized -100..100 magnitude. `rest`
 * is the raw reading at center; `positiveSpan` and `negativeSpan` are the raw
 * spans to full deflection on each side (they differ slightly, so each side
 * scales by its own span to reach exactly +-100). Readings within {@link
 * DEADZONE} of rest return 0; beyond it the live band `[deadzone..span]` rescales
 * to `[0..100]`. The result is rounded to whole percent and clamped.
 */
function normalizeAxis(raw: number, rest: number, positiveSpan: number, negativeSpan: number): number {
  const offset = rest - raw;
  const positive = offset >= 0;
  const magnitude = positive ? offset : -offset;
  if (magnitude <= DEADZONE) {
    return 0;
  }
  const span = positive ? positiveSpan : negativeSpan;
  let scaled = ((magnitude - DEADZONE) / (span - DEADZONE)) * 100;
  if (scaled > 100) {
    scaled = 100;
  }
  const rounded = Math.round(scaled);
  return positive ? rounded : -rounded;
}

/**
 * The live horizontal position in game convention: -100 (full left) to +100
 * (full right), centered on rest and dead-banded. Samples pin 2 fresh.
 */
export function readStickX(ctx: Context): number {
  return normalizeAxis(readHorizontalRaw(ctx), HORIZONTAL_REST, HORIZONTAL_RIGHT_SPAN, HORIZONTAL_LEFT_SPAN);
}

/**
 * The live vertical position in game convention: -100 (full down) to +100 (full
 * up), centered on rest and dead-banded. Samples pin 1 fresh.
 */
export function readStickY(ctx: Context): number {
  return normalizeAxis(readVerticalRaw(ctx), VERTICAL_REST, VERTICAL_UP_SPAN, VERTICAL_DOWN_SPAN);
}

/** Configures `pin` as a pull-up input and returns true while it reads LOW (pressed). */
function readActiveLow(ctx: Context, pin: number): boolean {
  ctx.microbit.gpio.setPull(pin, PULL_UP);
  return ctx.microbit.gpio.digitalRead(pin) === 0;
}

/** True while the stick is pressed straight down (pin 8, LOW-active). */
export function readStickPressed(ctx: Context): boolean {
  return readActiveLow(ctx, PRESS_PIN);
}

/** True while the button on `pin` is held (LOW-active). Use the exported `BUTTON_*_PIN` ids. */
export function readButtonPressed(ctx: Context, pin: number): boolean {
  return readActiveLow(ctx, pin);
}

/**
 * The stick's current discrete direction as one of the `DIRECTION_*` labels.
 * A press dominates (returns {@link DIRECTION_NONE}); otherwise the vertical
 * axis is checked before the horizontal, so at most one direction is active.
 */
export function readStickDirection(ctx: Context): string {
  if (readStickPressed(ctx)) {
    return DIRECTION_NONE;
  }
  const vertical = readVerticalRaw(ctx);
  if (vertical < DIRECTION_LOW) {
    return DIRECTION_UP;
  }
  if (vertical > DIRECTION_HIGH) {
    return DIRECTION_DOWN;
  }
  const horizontal = readHorizontalRaw(ctx);
  if (horizontal < DIRECTION_LOW) {
    return DIRECTION_RIGHT;
  }
  if (horizontal > DIRECTION_HIGH) {
    return DIRECTION_LEFT;
  }
  return DIRECTION_NONE;
}
