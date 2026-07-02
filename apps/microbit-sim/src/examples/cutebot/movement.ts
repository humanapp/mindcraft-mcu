import { type Context, System } from "mindcraft";

/** Cutebot STM8 motor-driver I2C address (7-bit). */
const CUTEBOT_ADDRESS = 0x10;

/** Wheel selector byte of a 4-byte motor command. */
const LEFT_WHEEL = 0x01;
const RIGHT_WHEEL = 0x02;

/** Direction byte of a 4-byte motor command. */
const FORWARD = 0x02;
const BACKWARD = 0x01;

/**
 * Wheel percents for the rate-word ladder, from three `slowly` words down at
 * crawl to three `quickly` words up at full speed. A single `slowly` sits above
 * the DC-motor stall floor; the compounded `slowly` steps sit below it and are
 * meaningful as fine trim blended with other influences.
 */
const RATE_SLOWLY_X3 = 10;
const RATE_SLOWLY_X2 = 18;
const RATE_SLOWLY_X1 = 30;
const RATE_BARE = 50;
const RATE_QUICKLY_X1 = 70;
const RATE_QUICKLY_X2 = 85;
const RATE_QUICKLY_X3 = 100;

/**
 * Number of consecutive silent thinks (no movement influence emitted) that
 * reuse the last blended target before the target drops to zero.
 */
const HOLD_WINDOW_THINKS = 3;

/** Clamps `value` into the inclusive `low`..`high` range. */
function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/**
 * Resolves the rate-word counts placed on a movement tile to a wheel percent
 * on the ladder. Counts above three clamp to the three-word step. The picker
 * keeps `slowly` and `quickly` mutually exclusive on a tile; if a brain
 * document nevertheless carries both, the slower command wins.
 */
export function rateFromWords(slowly: number, quickly: number): number {
  if (slowly >= 3) return RATE_SLOWLY_X3;
  if (slowly === 2) return RATE_SLOWLY_X2;
  if (slowly >= 1) return RATE_SLOWLY_X1;
  if (quickly >= 3) return RATE_QUICKLY_X3;
  if (quickly === 2) return RATE_QUICKLY_X2;
  if (quickly >= 1) return RATE_QUICKLY_X1;
  return RATE_BARE;
}

/**
 * Movement arbitrator for the Cutebot chassis: the one shared System every
 * movement tile feeds. Rules re-emit influences every think they fire; each
 * influence adds a signed wheel pair to this think's accumulators. Every
 * think, after rules run, `think` blends the accumulated influences into one
 * wheel pair, applies the drift trim, scale-preserving saturation, smoothing,
 * and the stop deadband, writes both wheels to the chassis, and clears the
 * accumulators. A think with no influences reuses the last blended target for
 * up to HOLD_WINDOW_THINKS consecutive thinks, then the robot stops.
 *
 * A stop issued this think supersedes it: every influence is discarded, the
 * smoothing state zeroes, the held target clears, and the chassis is written
 * (0, 0) regardless of what else was commanded and in which order.
 */
export const Movement = System({
  name: "movement",
  state: {
    /** Left-wheel influence sum for the current think, in signed percent. */
    accLeft: 0,
    /** Right-wheel influence sum for the current think, in signed percent. */
    accRight: 0,
    /** True when a stop was issued this think; cleared when the think ends. */
    stopRequested: false,
    /** True when a movement influence was emitted this think; cleared when the think ends. */
    emitted: false,
    /** Blended left-wheel target retained from the last emitting think, in signed percent. */
    heldLeft: 0,
    /** Blended right-wheel target retained from the last emitting think, in signed percent. */
    heldRight: 0,
    /** Count of consecutive silent thinks that have reused the held target. */
    holdAge: 0,
    /** Smoothed left-wheel output in signed percent; what the chassis was last driven toward. */
    outLeft: 0,
    /** Smoothed right-wheel output in signed percent; what the chassis was last driven toward. */
    outRight: 0,
    /** EMA retention factor, 0 (instant) to 0.99. */
    smoothing: 0,
    /** Per-wheel gain trim, -25 to +25; positive steers right. */
    drift: 0,
  },

  think(ctx: Context) {
    if (this.stopRequested) {
      this.stopRequested = false;
      this.outLeft = 0;
      this.outRight = 0;
      this.heldLeft = 0;
      this.heldRight = 0;
    } else {
      let targetLeft = 0;
      let targetRight = 0;
      if (this.emitted) {
        targetLeft = this.accLeft * (1 + this.drift / 200);
        targetRight = this.accRight * (1 - this.drift / 200);
        const peak = Math.max(Math.abs(targetLeft), Math.abs(targetRight));
        if (peak > 100) {
          targetLeft = targetLeft * (100 / peak);
          targetRight = targetRight * (100 / peak);
        }
        this.heldLeft = targetLeft;
        this.heldRight = targetRight;
        this.holdAge = 0;
      } else if (this.holdAge < HOLD_WINDOW_THINKS) {
        this.holdAge += 1;
        targetLeft = this.heldLeft;
        targetRight = this.heldRight;
      }
      this.outLeft = this.outLeft + (targetLeft - this.outLeft) * (1 - this.smoothing);
      if (Math.abs(targetLeft - this.outLeft) < 1) {
        this.outLeft = targetLeft;
      }
      this.outRight = this.outRight + (targetRight - this.outRight) * (1 - this.smoothing);
      if (Math.abs(targetRight - this.outRight) < 1) {
        this.outRight = targetRight;
      }
    }
    this.emitted = false;
    this.accLeft = 0;
    this.accRight = 0;

    const left = Math.abs(this.outLeft) < 2 ? 0 : this.outLeft;
    const right = Math.abs(this.outRight) < 2 ? 0 : this.outRight;
    const leftDirection = left >= 0 ? FORWARD : BACKWARD;
    const rightDirection = right >= 0 ? FORWARD : BACKWARD;
    const leftSpeed = Math.round(Math.abs(left));
    const rightSpeed = Math.round(Math.abs(right));
    ctx.microbit.i2c.writeBuffer(CUTEBOT_ADDRESS, Buffer.from([LEFT_WHEEL, leftDirection, leftSpeed, 0]));
    ctx.microbit.i2c.writeBuffer(CUTEBOT_ADDRESS, Buffer.from([RIGHT_WHEEL, rightDirection, rightSpeed, 0]));
  },

  /** Adds a straight influence: both wheels at `speed` signed percent (negative drives backward). */
  drive(speed: number) {
    this.emitted = true;
    this.accLeft += speed;
    this.accRight += speed;
  },

  /**
   * Adds a turn influence: the outer wheel drives at the rate, the held wheel
   * stays at rest. Positive `rate` turns right (left wheel drives), negative
   * turns left.
   */
  turn(rate: number) {
    this.emitted = true;
    if (rate >= 0) {
      this.accLeft += rate;
    } else {
      this.accRight += -rate;
    }
  },

  /**
   * Adds a spin-in-place influence: the wheels counter-rotate at the rate.
   * Positive `rate` pivots right, negative pivots left.
   */
  pivot(rate: number) {
    this.emitted = true;
    this.accLeft += rate;
    this.accRight -= rate;
  },

  /** Issues this think's exclusive stop: the think discards all influences, clears the held target, and writes (0, 0). */
  stop() {
    this.stopRequested = true;
  },

  /** Sets the smoothing factor, clamped to 0..0.99; 0 is instant. */
  setSmoothing(s: number) {
    this.smoothing = clamp(s, 0, 0.99);
  },

  /** The current smoothing factor. */
  getSmoothing(): number {
    return this.smoothing;
  },

  /** Sets the drift gain trim, clamped to -25..+25; positive steers right. */
  setDrift(d: number) {
    this.drift = clamp(d, -25, 25);
  },

  /** The current drift trim. */
  getDrift(): number {
    return this.drift;
  },
});
