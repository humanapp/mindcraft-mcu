import { type Context, System } from "mindcraft";

/**
 * Cutebot line-tracking sensor as a shared System. It samples the two
 * downward-facing line sensors every think and, per side, tracks whether the
 * sensor is currently over the line and whether it just crossed onto or off of
 * the line on this think.
 *
 * The left sensor is wired to pin 13 and the right to pin 14, both read with no
 * pull resistor. The Cutebot sensors pull their pin LOW over the line and leave
 * it HIGH off the line, so an on-line reading is a zero digital read (`=== 0`).
 *
 * `left()` and `right()` report the current on-line state per side.
 * `leftFound()` / `rightFound()` are true for the one think a side crossed onto
 * the line, and `leftLost()` / `rightLost()` for the one think it crossed off.
 * `think` samples after rule evaluation, so a rule observes the edge a side
 * crossed on the previous think.
 */
export const CutebotLine = System({
  name: "cutebot line",
  state: {
    /** True while the left sensor reads on-line. */
    leftOnLine: false,
    /** True while the right sensor reads on-line. */
    rightOnLine: false,
    /** True for the one think the left sensor crossed onto the line. */
    leftEdgeFound: false,
    /** True for the one think the left sensor crossed off the line. */
    leftEdgeLost: false,
    /** True for the one think the right sensor crossed onto the line. */
    rightEdgeFound: false,
    /** True for the one think the right sensor crossed off the line. */
    rightEdgeLost: false,
  },

  init(ctx: Context) {
    ctx.microbit.gpio.setPull(13, 0);
    ctx.microbit.gpio.setPull(14, 0);
    this.leftOnLine = ctx.microbit.gpio.digitalRead(13) === 0;
    this.rightOnLine = ctx.microbit.gpio.digitalRead(14) === 0;
    this.leftEdgeFound = false;
    this.leftEdgeLost = false;
    this.rightEdgeFound = false;
    this.rightEdgeLost = false;
  },

  think(ctx: Context) {
    this.updateLeft(ctx.microbit.gpio.digitalRead(13) === 0);
    this.updateRight(ctx.microbit.gpio.digitalRead(14) === 0);
  },

  /** Diffs a fresh left-sensor sample against the stored level and latches this think's edges. */
  updateLeft(onLine: boolean) {
    this.leftEdgeFound = onLine && !this.leftOnLine;
    this.leftEdgeLost = !onLine && this.leftOnLine;
    this.leftOnLine = onLine;
  },

  /** Diffs a fresh right-sensor sample against the stored level and latches this think's edges. */
  updateRight(onLine: boolean) {
    this.rightEdgeFound = onLine && !this.rightOnLine;
    this.rightEdgeLost = !onLine && this.rightOnLine;
    this.rightOnLine = onLine;
  },

  /** True while the left sensor is over the line. */
  left(): boolean {
    return this.leftOnLine;
  },

  /** True while the right sensor is over the line. */
  right(): boolean {
    return this.rightOnLine;
  },

  /** True for the one think the left sensor crossed onto the line. */
  leftFound(): boolean {
    return this.leftEdgeFound;
  },

  /** True for the one think the left sensor crossed off the line. */
  leftLost(): boolean {
    return this.leftEdgeLost;
  },

  /** True for the one think the right sensor crossed onto the line. */
  rightFound(): boolean {
    return this.rightEdgeFound;
  },

  /** True for the one think the right sensor crossed off the line. */
  rightLost(): boolean {
    return this.rightEdgeLost;
  },
});
