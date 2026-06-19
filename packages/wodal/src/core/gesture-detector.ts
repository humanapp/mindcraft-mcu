/**
 * Faithful port of CODAL's accelerometer gesture engine (codal-core
 * Accelerometer.cpp: `instantaneousPosture`, `updateGesture`, and
 * `recalculatePitchRoll`) for the interactive WODAL sim. It turns a stream of
 * simulated x/y/z samples into the pollable gesture code CODAL's `getGesture()`
 * reports and into the rotation-compensated pitch/roll radians.
 *
 * It models the gestures CODAL writes to the pollable `lastGesture`: the four
 * tilts, two faces, shake, and freefall. CODAL delivers impacts (2G/3G/6G/8G)
 * as message-bus events that never reach `lastGesture`; this detector does not
 * produce them.
 */

import { AccelerometerGesture, type Sample3D } from "./accelerometer";

/** Per-axis acceleration, in milli-g, above which a zero crossing counts toward a shake (CODAL ACCELEROMETER_SHAKE_TOLERANCE). */
const SHAKE_TOLERANCE = 400;

/** Distance, in milli-g, from a 1G axis reading within which the device counts as tilted on that axis (CODAL ACCELEROMETER_TILT_TOLERANCE). */
const TILT_TOLERANCE = 200;

/** Acceleration, in milli-g, below which (per axis, before squaring) the device is in freefall (CODAL ACCELEROMETER_FREEFALL_TOLERANCE). */
const FREEFALL_TOLERANCE = 400;

/** Squared-acceleration threshold below which the combined force is freefall (CODAL ACCELEROMETER_FREEFALL_THRESHOLD). */
const FREEFALL_THRESHOLD = FREEFALL_TOLERANCE * FREEFALL_TOLERANCE;

/** Stable-sample count a posture must persist before it is promoted to the reported gesture (CODAL ACCELEROMETER_GESTURE_DAMPING). */
const GESTURE_DAMPING = 5;

/** Sample count between decays of the accumulated zero-crossing count (CODAL ACCELEROMETER_SHAKE_DAMPING). */
const SHAKE_DAMPING = 10;

/** Sample count after a shake before another shake may be reported (CODAL ACCELEROMETER_SHAKE_RTX). */
const SHAKE_RTX = 30;

/** Zero crossings required, across the three axes, to register a shake (CODAL ACCELEROMETER_SHAKE_COUNT_THRESHOLD). */
const SHAKE_COUNT_THRESHOLD = 4;

/** A 1G axis reading, in milli-g, the resting force on the axis aligned with gravity. */
const ONE_G = 1000;

/**
 * Rotation-compensated pitch and roll for a sample, in radians, each stored at
 * f32 precision. Ports CODAL's `recalculatePitchRoll`: the f32-rounded roll
 * feeds the pitch computation, and a positive z reflects pitch into the
 * adjacent quadrant.
 *
 * @param sample - Acceleration sample in milli-g.
 * @returns The pitch and roll in radians, each rounded to f32.
 */
export function recalculatePitchRoll(sample: Sample3D): { pitchRadians: number; rollRadians: number } {
  const x = sample.x;
  const y = sample.y;
  const z = sample.z;

  const rollRadians = Math.fround(Math.atan2(x, -z));
  let pitchRadians = Math.fround(Math.atan2(y, x * Math.sin(rollRadians) - z * Math.cos(rollRadians)));

  if (z > 0) {
    const reference = pitchRadians > 0 ? Math.PI / 2 : -Math.PI / 2;
    pitchRadians = Math.fround(reference + (reference - pitchRadians));
  }

  return { pitchRadians, rollRadians };
}

/**
 * CODAL's stateful gesture recognizer. Feed it successive samples with {@link
 * GestureDetector.update}; it tracks zero-crossing shake history and the
 * low-pass posture filter across calls and returns the current pollable gesture.
 */
export class GestureDetector {
  /** Ticks the instantaneous posture has matched {@link currentGesture}. */
  private sigma = 0;

  /** The stable, reported gesture (the value `getGesture()` returns). */
  private lastGesture: AccelerometerGesture = AccelerometerGesture.None;

  /** The instantaneous, unfiltered posture from the latest sample. */
  private currentGesture: AccelerometerGesture = AccelerometerGesture.None;

  /** Whether each axis is currently latched on the negative side of a zero crossing. */
  private crossedX = false;
  private crossedY = false;
  private crossedZ = false;

  /** Whether a shake has been reported and is awaiting the retrigger window. */
  private shaken = false;

  /** Accumulated zero crossings toward {@link SHAKE_COUNT_THRESHOLD}. */
  private shakeCount = 0;

  /** Ticks since the shake count first became non-zero, used for retrigger and decay. */
  private shakeTimer = 0;

  /**
   * Advances the recognizer by one sample and returns the current pollable
   * gesture.
   *
   * @param sample - Acceleration sample in milli-g.
   * @returns The stable gesture code now reported.
   */
  update(sample: Sample3D): AccelerometerGesture {
    const posture = this.instantaneousPosture(sample);

    if (posture === AccelerometerGesture.Shake) {
      this.lastGesture = AccelerometerGesture.Shake;
      return this.lastGesture;
    }

    if (posture === this.currentGesture) {
      if (this.sigma < GESTURE_DAMPING) {
        this.sigma++;
      }
    } else {
      this.currentGesture = posture;
      this.sigma = 0;
    }

    if (this.currentGesture !== this.lastGesture && this.sigma >= GESTURE_DAMPING) {
      this.lastGesture = this.currentGesture;
    }

    return this.lastGesture;
  }

  /** Restores the recognizer to its resting state, clearing shake and filter history. */
  reset(): void {
    this.sigma = 0;
    this.lastGesture = AccelerometerGesture.None;
    this.currentGesture = AccelerometerGesture.None;
    this.crossedX = false;
    this.crossedY = false;
    this.crossedZ = false;
    this.shaken = false;
    this.shakeCount = 0;
    this.shakeTimer = 0;
  }

  /** Combined force across all axes (sum of squares), as CODAL's uint32 `instantaneousAccelerationSquared`. */
  private accelerationSquared(sample: Sample3D): number {
    return (Math.imul(sample.x, sample.x) + Math.imul(sample.y, sample.y) + Math.imul(sample.z, sample.z)) >>> 0;
  }

  /**
   * CODAL's `instantaneousPosture`: a best-guess posture from one sample, with
   * the shake zero-crossing detector folded in. Mutates the shake history.
   */
  private instantaneousPosture(sample: Sample3D): AccelerometerGesture {
    let shakeDetected = false;

    if ((sample.x < -SHAKE_TOLERANCE && this.crossedX) || (sample.x > SHAKE_TOLERANCE && !this.crossedX)) {
      shakeDetected = true;
      this.crossedX = !this.crossedX;
    }

    if ((sample.y < -SHAKE_TOLERANCE && this.crossedY) || (sample.y > SHAKE_TOLERANCE && !this.crossedY)) {
      shakeDetected = true;
      this.crossedY = !this.crossedY;
    }

    if ((sample.z < -SHAKE_TOLERANCE && this.crossedZ) || (sample.z > SHAKE_TOLERANCE && !this.crossedZ)) {
      shakeDetected = true;
      this.crossedZ = !this.crossedZ;
    }

    if (shakeDetected && this.shakeCount < SHAKE_COUNT_THRESHOLD) {
      this.shakeCount++;

      if (this.shakeCount === 1) {
        this.shakeTimer = 0;
      }

      if (this.shakeCount === SHAKE_COUNT_THRESHOLD) {
        this.shaken = true;
        this.shakeTimer = 0;
        return AccelerometerGesture.Shake;
      }
    }

    if (this.shakeCount > 0) {
      this.shakeTimer++;

      if (this.shaken && this.shakeTimer >= SHAKE_RTX) {
        this.shaken = false;
        this.shakeTimer = 0;
        this.shakeCount = 0;
      } else if (!this.shaken && this.shakeTimer >= SHAKE_DAMPING) {
        this.shakeTimer = 0;
        if (this.shakeCount > 0) {
          this.shakeCount--;
        }
      }
    }

    if (this.accelerationSquared(sample) < FREEFALL_THRESHOLD) {
      return AccelerometerGesture.Freefall;
    }

    if (sample.x < -ONE_G + TILT_TOLERANCE) {
      return AccelerometerGesture.TiltLeft;
    }

    if (sample.x > ONE_G - TILT_TOLERANCE) {
      return AccelerometerGesture.TiltRight;
    }

    if (sample.y < -ONE_G + TILT_TOLERANCE) {
      return AccelerometerGesture.TiltDown;
    }

    if (sample.y > ONE_G - TILT_TOLERANCE) {
      return AccelerometerGesture.TiltUp;
    }

    if (sample.z < -ONE_G + TILT_TOLERANCE) {
      return AccelerometerGesture.FaceUp;
    }

    if (sample.z > ONE_G - TILT_TOLERANCE) {
      return AccelerometerGesture.FaceDown;
    }

    return AccelerometerGesture.None;
  }
}
