import { AccelerometerGesture, type Sample3D } from "./accelerometer";
import { GESTURE_DAMPING, ONE_G, SHAKE_COUNT_THRESHOLD, SHAKE_TOLERANCE } from "./gesture-detector";

/**
 * The accelerometer behaviour {@link GestureInjector} drives: it feeds simulated
 * motion samples at the device sample period.
 */
export interface GestureSampleTarget {
  /** Returns the device sample period in milliseconds. */
  getPeriod(): number;

  /** Plays one simulated acceleration sample through the gesture detector. */
  feedSample(sample: Sample3D): void;
}

/**
 * Resting acceleration reading, in milli-g, fed when no gesture is selected.
 * Every axis stays under the 800 mg tilt/face threshold and the magnitude is
 * ~1000 mg, so the detector reports {@link AccelerometerGesture.None}.
 */
export const IDLE_SAMPLE: Sample3D = { x: 480, y: -600, z: -640 };

/** Number of samples a sticky posture ramps over before it holds at the target reading. */
const RAMP_SAMPLES = 8;

/** Per-axis amplitude, in milli-g, of the shake oscillation; above the shake tolerance and below the tilt threshold. */
const SHAKE_AMPLITUDE = SHAKE_TOLERANCE + 200;

/** Number of alternating samples in the shake sequence. */
const SHAKE_SAMPLE_COUNT = SHAKE_COUNT_THRESHOLD + 2;

/** Number of ~0 g samples held in the freefall sequence. */
const FREEFALL_SAMPLE_COUNT = GESTURE_DAMPING * 2;

/** The target reading, in milli-g, a sticky posture gesture holds. Returns undefined for non-posture gestures. */
function postureSample(gesture: AccelerometerGesture): Sample3D | undefined {
  switch (gesture) {
    case AccelerometerGesture.TiltLeft:
      return { x: -ONE_G, y: 0, z: 0 };
    case AccelerometerGesture.TiltRight:
      return { x: ONE_G, y: 0, z: 0 };
    case AccelerometerGesture.TiltDown:
      return { x: 0, y: -ONE_G, z: 0 };
    case AccelerometerGesture.TiltUp:
      return { x: 0, y: ONE_G, z: 0 };
    case AccelerometerGesture.FaceUp:
      return { x: 0, y: 0, z: -ONE_G };
    case AccelerometerGesture.FaceDown:
      return { x: 0, y: 0, z: ONE_G };
    default:
      return undefined;
  }
}

/** Builds the shake sequence: alternating x swings that cross the shake tolerance enough times to trip the zero-crossing detector. */
function shakeSequence(): Sample3D[] {
  return Array.from({ length: SHAKE_SAMPLE_COUNT }, (_unused, index) => ({
    x: index % 2 === 0 ? SHAKE_AMPLITUDE : -SHAKE_AMPLITUDE,
    y: 0,
    z: 0,
  }));
}

/** Builds the freefall sequence: a ~0 g sample held under the freefall threshold for its detection window. */
function freefallSequence(): Sample3D[] {
  return Array.from({ length: FREEFALL_SAMPLE_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
}

function lerpSample(from: Sample3D, to: Sample3D, fraction: number): Sample3D {
  return {
    x: Math.round(from.x + (to.x - from.x) * fraction),
    y: Math.round(from.y + (to.y - from.y) * fraction),
    z: Math.round(from.z + (to.z - from.z) * fraction),
  };
}

/**
 * Plays a selected gesture into an {@link Accelerometer} by feeding it a timed
 * x/y/z sample sequence at the device sample period, driving the real gesture
 * detector to recognize it. One instance per simulated device's accelerometer.
 *
 * Posture gestures (the four tilts and two faces) are sticky: the feed ramps to
 * the posture's reading and holds it until the selection changes. Shake and
 * freefall are momentary: their sequence plays once, then the feed returns to
 * the idle reading and the completion listener fires. Selecting {@link
 * AccelerometerGesture.None} returns to the idle reading.
 *
 * Feeding is decoupled from any brain tick: {@link GestureInjector.advance}
 * accumulates elapsed time and feeds zero-or-more samples as it crosses the
 * period, so recognized gesture durations match the device. The sample sequence
 * content reads no clock; only the feed scheduling uses elapsed time.
 */
export class GestureInjector {
  private readonly target: GestureSampleTarget;
  private accumulatorMs = 0;
  private mode: "hold" | "momentary" = "hold";

  /** Last sample fed; the start point a new ramp interpolates from. */
  private lastSample: Sample3D = IDLE_SAMPLE;

  /** Hold-mode ramp endpoints and progress. */
  private rampStart: Sample3D = IDLE_SAMPLE;
  private holdTarget: Sample3D = IDLE_SAMPLE;
  private holdStep = 0;

  /** Momentary-mode sequence, cursor, and the gesture it recognizes. */
  private momentarySamples: readonly Sample3D[] = [];
  private momentaryStep = 0;
  private momentaryGesture: AccelerometerGesture = AccelerometerGesture.None;

  private completionListener: ((gesture: AccelerometerGesture) => void) | undefined;

  /**
   * @param target - The accelerometer this injector feeds.
   */
  constructor(target: GestureSampleTarget) {
    this.target = target;
  }

  /**
   * Registers the listener invoked when a momentary gesture (shake or freefall)
   * finishes playing, with the completed gesture. Pass undefined to clear it.
   * Postures and {@link AccelerometerGesture.None} never invoke it.
   */
  setCompletionListener(listener: ((gesture: AccelerometerGesture) => void) | undefined): void {
    this.completionListener = listener;
  }

  /**
   * Selects the gesture to play. Postures hold until the next selection; shake
   * and freefall play once and then return to idle. {@link
   * AccelerometerGesture.None} (or any unsupported gesture) returns to the idle
   * reading.
   *
   * @param gesture - The gesture to inject.
   */
  select(gesture: AccelerometerGesture): void {
    if (gesture === AccelerometerGesture.Shake) {
      this.startMomentary(AccelerometerGesture.Shake, shakeSequence());
      return;
    }
    if (gesture === AccelerometerGesture.Freefall) {
      this.startMomentary(AccelerometerGesture.Freefall, freefallSequence());
      return;
    }
    this.enterHold(postureSample(gesture) ?? IDLE_SAMPLE);
  }

  /**
   * Advances the feed by elapsed time, feeding one sample per elapsed sample
   * period. Feeds zero-or-more samples as the accumulated time crosses the
   * period.
   *
   * @param elapsedMs - Elapsed simulated time in milliseconds.
   */
  advance(elapsedMs: number): void {
    const period = this.target.getPeriod();
    if (period <= 0) {
      return;
    }
    this.accumulatorMs += elapsedMs;
    while (this.accumulatorMs >= period) {
      this.accumulatorMs -= period;
      this.feedStep();
    }
  }

  private startMomentary(gesture: AccelerometerGesture, samples: readonly Sample3D[]): void {
    this.mode = "momentary";
    this.momentaryGesture = gesture;
    this.momentarySamples = samples;
    this.momentaryStep = 0;
  }

  private enterHold(targetSample: Sample3D): void {
    this.mode = "hold";
    this.rampStart = this.lastSample;
    this.holdTarget = targetSample;
    this.holdStep = 0;
  }

  private feedStep(): void {
    if (this.mode === "momentary") {
      this.feedMomentaryStep();
    } else {
      this.feedHoldStep();
    }
  }

  private feedHoldStep(): void {
    let sample: Sample3D;
    if (this.holdStep < RAMP_SAMPLES) {
      sample = lerpSample(this.rampStart, this.holdTarget, (this.holdStep + 1) / RAMP_SAMPLES);
    } else {
      sample = this.holdTarget;
    }
    if (this.holdStep < RAMP_SAMPLES) {
      this.holdStep++;
    }
    this.feed(sample);
  }

  private feedMomentaryStep(): void {
    if (this.momentaryStep >= this.momentarySamples.length) {
      const completed = this.momentaryGesture;
      this.momentaryGesture = AccelerometerGesture.None;
      this.enterHold(IDLE_SAMPLE);
      this.feedHoldStep();
      this.completionListener?.(completed);
      return;
    }
    this.feed(this.momentarySamples[this.momentaryStep]!);
    this.momentaryStep++;
  }

  private feed(sample: Sample3D): void {
    this.lastSample = sample;
    this.target.feedSample(sample);
  }
}
