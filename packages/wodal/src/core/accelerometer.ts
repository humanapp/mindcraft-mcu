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

/**
 * Accelerometer gesture codes, transcribed verbatim from CODAL's
 * `driver-models/Accelerometer.h` (`ACCELEROMETER_EVT_*`). {@link
 * Accelerometer.getGesture} returns one of these values. The four impact codes
 * are not in magnitude order: 2G follows 8G in the CODAL numbering.
 */
export enum AccelerometerGesture {
  None = 0,
  TiltUp = 1,
  TiltDown = 2,
  TiltLeft = 3,
  TiltRight = 4,
  FaceUp = 5,
  FaceDown = 6,
  Freefall = 7,
  Impact3G = 8,
  Impact6G = 9,
  Impact8G = 10,
  Shake = 11,
  Impact2G = 12,
}

/** Gesture value reported when no gesture has been recognized. */
export const ACCELEROMETER_EVT_NONE = AccelerometerGesture.None;

/**
 * Whole degrees for a radian orientation, matching CODAL's
 * `int getPitch() { return (int)((360.0f*radians)/(2.0f*(float)PI)); }` at f32
 * precision (truncated toward zero).
 */
function degreesFromRadians(radians: number): number {
  const twoPi = Math.fround(2 * Math.fround(Math.PI));
  return Math.trunc(Math.fround(Math.fround(360 * radians) / twoPi));
}

/** Software accelerometer model with injectable sample data. */
export class Accelerometer {
  private period = 20;
  private range = 2;
  private sample: Sample3D = { x: 0, y: 0, z: -1000 };
  private gesture = ACCELEROMETER_EVT_NONE;
  private pitchRadians = 0;
  private rollRadians = 0;

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

  /** Returns the current rotation-compensated pitch in whole degrees, derived from the radian reading. */
  getPitch(): number {
    return degreesFromRadians(this.pitchRadians);
  }

  /** Returns the current rotation-compensated roll in whole degrees, derived from the radian reading. */
  getRoll(): number {
    return degreesFromRadians(this.rollRadians);
  }

  /** Returns the current rotation-compensated pitch in radians. */
  getPitchRadians(): number {
    return this.pitchRadians;
  }

  /**
   * Replaces the current pitch reading in radians.
   *
   * @param radians - Rotation-compensated pitch in radians, rounded to the device's f32 precision.
   */
  setPitchRadians(radians: number): void {
    this.pitchRadians = Math.fround(radians);
  }

  /** Returns the current rotation-compensated roll in radians. */
  getRollRadians(): number {
    return this.rollRadians;
  }

  /**
   * Replaces the current roll reading in radians.
   *
   * @param radians - Rotation-compensated roll in radians, rounded to the device's f32 precision.
   */
  setRollRadians(radians: number): void {
    this.rollRadians = Math.fround(radians);
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

  /** Resets the transient sensor reading, orientation, and gesture to their resting defaults. Period and range are configuration and are preserved. */
  reset(): void {
    this.sample = { x: 0, y: 0, z: -1000 };
    this.gesture = ACCELEROMETER_EVT_NONE;
    this.pitchRadians = 0;
    this.rollRadians = 0;
  }

  private normalizeAxis(value: number): number {
    return clampInt16(value);
  }
}
