import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Accelerometer, AccelerometerGesture, type Sample3D } from "./accelerometer";
import { GestureInjector, type GestureSampleTarget, IDLE_SAMPLE } from "./gesture-injector";

const PERIOD_MS = 20;

/** Records every fed sample and reports a fixed period, for cadence assertions. */
class RecordingTarget implements GestureSampleTarget {
  readonly samples: Sample3D[] = [];
  period = PERIOD_MS;

  getPeriod(): number {
    return this.period;
  }

  feedSample(sample: Sample3D): void {
    this.samples.push(sample);
  }
}

/** Advances the injector by `periods` whole sample periods, one feed at a time. */
function feedPeriods(injector: GestureInjector, periods: number): void {
  for (let i = 0; i < periods; i++) {
    injector.advance(PERIOD_MS);
  }
}

const POSTURES: readonly AccelerometerGesture[] = [
  AccelerometerGesture.TiltLeft,
  AccelerometerGesture.TiltRight,
  AccelerometerGesture.TiltUp,
  AccelerometerGesture.TiltDown,
  AccelerometerGesture.FaceUp,
  AccelerometerGesture.FaceDown,
];

describe("GestureInjector cadence", () => {
  it("feeds one sample per elapsed sample period, accumulating across calls", () => {
    const target = new RecordingTarget();
    const injector = new GestureInjector(target);

    injector.advance(50); // two whole periods, 10 ms carried
    assert.equal(target.samples.length, 2);

    injector.advance(10); // 10 + 10 reaches one more period
    assert.equal(target.samples.length, 3);

    injector.advance(5); // below the period: no feed
    assert.equal(target.samples.length, 3);
  });

  it("feeds the idle reading until a gesture is selected", () => {
    const target = new RecordingTarget();
    const injector = new GestureInjector(target);

    injector.advance(PERIOD_MS);
    assert.deepEqual(target.samples[0], IDLE_SAMPLE);
  });

  it("does not feed when the period is non-positive", () => {
    const target = new RecordingTarget();
    target.period = 0;
    const injector = new GestureInjector(target);

    injector.advance(1000);
    assert.equal(target.samples.length, 0);
  });
});

describe("GestureInjector posture gestures", () => {
  for (const gesture of POSTURES) {
    it(`recognizes and holds ${AccelerometerGesture[gesture]}`, () => {
      const accelerometer = new Accelerometer();
      const injector = new GestureInjector(accelerometer);

      injector.select(gesture);
      feedPeriods(injector, 30);
      assert.equal(accelerometer.getGesture(), gesture);

      // Sticky: the posture persists for as long as the selection stands.
      feedPeriods(injector, 90);
      assert.equal(accelerometer.getGesture(), gesture);
    });
  }

  it("returns to the idle reading when none is selected", () => {
    const accelerometer = new Accelerometer();
    const injector = new GestureInjector(accelerometer);

    injector.select(AccelerometerGesture.TiltRight);
    feedPeriods(injector, 30);
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.TiltRight);

    injector.select(AccelerometerGesture.None);
    feedPeriods(injector, 30);
    assert.equal(accelerometer.getGesture(), AccelerometerGesture.None);
    assert.deepEqual(accelerometer.getSample(), IDLE_SAMPLE);
  });
});

describe("GestureInjector momentary gestures", () => {
  for (const gesture of [AccelerometerGesture.Shake, AccelerometerGesture.Freefall]) {
    it(`recognizes ${AccelerometerGesture[gesture]} once, then returns to idle and reports completion`, () => {
      const accelerometer = new Accelerometer();
      const injector = new GestureInjector(accelerometer);
      const completed: AccelerometerGesture[] = [];
      injector.setCompletionListener((finished) => completed.push(finished));

      // Establish the resting reading before the momentary gesture plays.
      feedPeriods(injector, 5);

      injector.select(gesture);
      let recognized = false;
      for (let i = 0; i < 60 && completed.length === 0; i++) {
        injector.advance(PERIOD_MS);
        if (accelerometer.getGesture() === gesture) {
          recognized = true;
        }
      }

      assert.ok(recognized, "expected the gesture to be recognized while playing");
      assert.deepEqual(completed, [gesture]);

      // After completion the feed settles back to the resting None reading.
      feedPeriods(injector, 30);
      assert.equal(accelerometer.getGesture(), AccelerometerGesture.None);
    });
  }

  it("does not report completion for postures or none", () => {
    const accelerometer = new Accelerometer();
    const injector = new GestureInjector(accelerometer);
    const completed: AccelerometerGesture[] = [];
    injector.setCompletionListener((finished) => completed.push(finished));

    injector.select(AccelerometerGesture.FaceDown);
    feedPeriods(injector, 30);
    injector.select(AccelerometerGesture.None);
    feedPeriods(injector, 30);

    assert.deepEqual(completed, []);
  });
});

describe("GestureInjector current selection", () => {
  it("reports None before any selection", () => {
    const injector = new GestureInjector(new Accelerometer());
    assert.equal(injector.currentGesture(), AccelerometerGesture.None);
  });

  for (const gesture of [AccelerometerGesture.TiltLeft, AccelerometerGesture.FaceUp]) {
    it(`holds ${AccelerometerGesture[gesture]} across advances`, () => {
      const injector = new GestureInjector(new Accelerometer());

      injector.select(gesture);
      assert.equal(injector.currentGesture(), gesture);

      // The held posture survives feeding: the selection is what the picker reads back.
      feedPeriods(injector, 90);
      assert.equal(injector.currentGesture(), gesture);
    });
  }

  it("reports None when none is selected", () => {
    const injector = new GestureInjector(new Accelerometer());

    injector.select(AccelerometerGesture.TiltRight);
    assert.equal(injector.currentGesture(), AccelerometerGesture.TiltRight);

    injector.select(AccelerometerGesture.None);
    assert.equal(injector.currentGesture(), AccelerometerGesture.None);
  });

  it("reports a momentary gesture while it plays, then resets to None on completion", () => {
    const injector = new GestureInjector(new Accelerometer());
    const completed: AccelerometerGesture[] = [];
    injector.setCompletionListener((finished) => completed.push(finished));

    feedPeriods(injector, 5);

    injector.select(AccelerometerGesture.Shake);
    assert.equal(injector.currentGesture(), AccelerometerGesture.Shake);

    let reportedWhilePlaying = false;
    for (let i = 0; i < 60 && completed.length === 0; i++) {
      injector.advance(PERIOD_MS);
      if (injector.currentGesture() === AccelerometerGesture.Shake) {
        reportedWhilePlaying = true;
      }
    }

    assert.ok(reportedWhilePlaying, "expected the selection to read Shake while it played");
    assert.deepEqual(completed, [AccelerometerGesture.Shake]);
    assert.equal(injector.currentGesture(), AccelerometerGesture.None);
  });
});
