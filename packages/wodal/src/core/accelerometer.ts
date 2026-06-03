import { clampInt16, clampInt32, toInt32 } from "./numeric";

/** Three-axis accelerometer sample measured in milli-g. */
export interface Sample3D {
  /** Acceleration along the X axis in milli-g. */
  readonly x: number;

  /** Acceleration along the Y axis in milli-g. */
  readonly y: number;

  /** Acceleration along the Z axis in milli-g. */
  readonly z: number;
}

/** Coordinate systems accepted by accelerometer sample reads. */
export type CoordinateSystem = "simple" | "raw";

/** Gesture value reported when no gesture has been recognized. */
export const ACCELEROMETER_EVT_NONE = 0;

/** Software accelerometer model with injectable sample data. */
export class Accelerometer {
  private period = 20;
  private range = 2;
  private sample: Sample3D = { x: 0, y: 0, z: -1000 };
  private gesture = ACCELEROMETER_EVT_NONE;

  /**
   * Sets the requested sample period.
   *
   * @param milliseconds - Desired sample period in milliseconds.
   * @returns 0 when accepted, otherwise -1.
   */
  setPeriod(milliseconds: number): number {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      return -1;
    }
    this.period = clampInt32(milliseconds);
    return 0;
  }

  /** Returns the configured sample period in milliseconds. */
  getPeriod(): number {
    return this.period;
  }

  /**
   * Sets the measurement range.
   *
   * @param g - Maximum acceleration in gravity units.
   * @returns 0 when accepted, otherwise -1.
   */
  setRange(g: number): number {
    if (!Number.isFinite(g) || g <= 0) {
      return -1;
    }
    this.range = clampInt32(g);
    return 0;
  }

  /** Returns the configured measurement range in gravity units. */
  getRange(): number {
    return this.range;
  }

  /** Applies pending hardware configuration in CODAL. */
  configure(): number {
    return 0;
  }

  /** Requests a new sensor sample in CODAL. */
  requestUpdate(): number {
    return 0;
  }

  /** Refreshes derived values from the current sample. */
  update(): number {
    return 0;
  }

  /**
   * Replaces the current simulated acceleration sample.
   *
   * @param sample - Three-axis acceleration sample in milli-g.
   */
  setSample(sample: Sample3D): void {
    this.sample = {
      x: this.normalizeAxis(sample.x),
      y: this.normalizeAxis(sample.y),
      z: this.normalizeAxis(sample.z),
    };
  }

  /**
   * Returns the current acceleration sample.
   *
   * @param _system - Coordinate system selector accepted for CODAL API parity.
   */
  getSample(_system: CoordinateSystem = "simple"): Sample3D {
    return { ...this.sample };
  }

  /** Returns the X axis acceleration in milli-g. */
  getX(): number {
    return this.sample.x;
  }

  /** Returns the Y axis acceleration in milli-g. */
  getY(): number {
    return this.sample.y;
  }

  /** Returns the Z axis acceleration in milli-g. */
  getZ(): number {
    return this.sample.z;
  }

  /** Returns pitch in degrees. */
  getPitch(): number {
    return Math.round((this.getPitchRadians() * 180) / Math.PI);
  }

  /** Returns pitch in radians. */
  getPitchRadians(): number {
    return Math.atan2(this.sample.x, Math.hypot(this.sample.y, this.sample.z));
  }

  /** Returns roll in degrees. */
  getRoll(): number {
    return Math.round((this.getRollRadians() * 180) / Math.PI);
  }

  /** Returns roll in radians. */
  getRollRadians(): number {
    return Math.atan2(this.sample.y, Math.hypot(this.sample.x, this.sample.z));
  }

  /** Returns the current simulated gesture value. */
  getGesture(): number {
    return this.gesture;
  }

  /**
   * Sets the current simulated gesture value.
   *
   * @param gesture - Numeric gesture constant.
   */
  setGesture(gesture: number): void {
    this.gesture = toInt32(gesture);
  }

  /** Resets the transient sensor reading and gesture to their resting defaults. Period and range are configuration and are preserved. */
  reset(): void {
    this.sample = { x: 0, y: 0, z: -1000 };
    this.gesture = ACCELEROMETER_EVT_NONE;
  }

  private normalizeAxis(value: number): number {
    return clampInt16(value);
  }
}
