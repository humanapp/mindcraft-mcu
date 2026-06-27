import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MicroBitDisplay } from "./microbit-display";

describe("MicroBitDisplay async scroll", () => {
  test("a scroll completes one full duration after its request time", () => {
    const display = new MicroBitDisplay();
    let completedAt: number | undefined;

    display.scrollText("hi", 1000, 100, () => {
      completedAt = 1100;
    });
    assert.equal(display.isScrolling(), true);

    // Before the completion time nothing fires.
    display.advanceScroll(1099);
    assert.equal(completedAt, undefined);
    assert.equal(display.isScrolling(), true);

    // At the completion time the animation completes exactly once.
    display.advanceScroll(1100);
    assert.equal(completedAt, 1100);
    assert.equal(display.isScrolling(), false);

    // A later advance does not re-fire it.
    let extra = 0;
    display.scrollText("", 0, 2000, () => {
      extra += 1;
    });
    display.advanceScroll(2000);
    display.advanceScroll(3000);
    assert.equal(extra, 1);
  });

  test("a scroll requested while one is in progress is dropped and settles at once", () => {
    const display = new MicroBitDisplay();
    const order: string[] = [];

    // First scroll: requested at t=0, 600ms long -> completes at 600.
    display.scrollText("a", 600, 0, () => order.push("a"));
    // Second scroll requested at t=100 while the first runs: dropped, so its
    // onComplete fires at once and the active scroll is untouched.
    display.scrollText("b", 600, 100, () => order.push("b"));
    assert.deepEqual(order, ["b"]);
    assert.equal(display.isScrolling(), true);

    display.advanceScroll(599);
    assert.deepEqual(order, ["b"]);

    display.advanceScroll(600);
    assert.deepEqual(order, ["b", "a"]);
    assert.equal(display.isScrolling(), false);
  });

  test("renders glyph columns into the matrix as the text scrolls in, then clears on completion", () => {
    const display = new MicroBitDisplay();

    // The "!" glyph (pendolino3 rows 0x08,0x08,0x08,0x00,0x08) is a vertical bar
    // in the second column, lit on rows 0,1,2,4. Each step is 120ms; after two
    // steps that column reaches the rightmost display column (x=4).
    display.scrollText("!", 6 * 2 * 120, 0, () => {});
    display.advanceScroll(240);

    assert.deepEqual(
      [0, 1, 2, 3, 4].map((y) => display.getPixelValue(4, y)),
      [255, 255, 255, 0, 255]
    );

    // After the full duration the text has scrolled off and the display is clear.
    display.advanceScroll(6 * 2 * 120);
    assert.equal(display.isScrolling(), false);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        assert.equal(display.getPixelValue(x, y), 0, `pixel (${x},${y}) should be clear`);
      }
    }
  });

  test("a scroll clears a prior drawn image so it does not linger under the animation", () => {
    const display = new MicroBitDisplay();

    // A fire-and-forget draw paints the top row but takes no lease.
    const frame = new Array(25).fill(0);
    for (let x = 0; x < 5; x++) {
      frame[x] = 255;
    }
    display.drawImage([{ frame, width: 5, height: 5 }], 0, 0, () => {});
    assert.equal(display.getPixelValue(0, 0), 255);

    // Scrolling clears the display before animating, so the drawn row is gone.
    display.scrollText("hi", 6 * 3 * 120, 0, () => {});
    for (let x = 0; x < 5; x++) {
      assert.equal(display.getPixelValue(x, 0), 0, `drawn pixel (${x},0) should be cleared`);
    }
  });

  test("reset drops the scroll in progress so a later scroll starts fresh", () => {
    const display = new MicroBitDisplay();

    // A scroll in progress when the device resets must be dropped; otherwise the
    // next scroll would be rejected as "busy" and never show.
    display.scrollText("hello", 6 * 6 * 120, 0, () => {});
    display.reset();
    assert.equal(display.isScrolling(), false);

    let completed = false;
    display.scrollText("hi", 6 * 3 * 120, 10, () => {
      completed = true;
    });
    assert.equal(display.isScrolling(), true);
    display.advanceScroll(10 + 6 * 3 * 120);
    assert.ok(completed, "the new scroll should run on its own timeline");
  });

  test("a scroll requested after the display frees starts at its request time", () => {
    const display = new MicroBitDisplay();
    let secondAt: number | undefined;

    display.scrollText("a", 600, 0, () => {});
    display.advanceScroll(600);

    // The display is free; a scroll requested at 1000 completes at 1600, not
    // chained off the earlier animation.
    display.scrollText("b", 600, 1000, () => {
      secondAt = 1600;
    });
    display.advanceScroll(1599);
    assert.equal(secondAt, undefined);
    display.advanceScroll(1600);
    assert.equal(secondAt, 1600);
  });
});

describe("MicroBitDisplay image sequence", () => {
  /** A single-pixel frame lighting (col,0) at full brightness; the col marks which frame is shown. */
  function markerFrame(col: number) {
    const frame = new Array(5).fill(0);
    frame[col] = 255;
    return { frame, width: 5, height: 1 };
  }

  test("plays each frame for its hold under one lease and resolves at the total", () => {
    const display = new MicroBitDisplay();
    let completedAt: number | undefined;

    // Three frames, 100ms each: lease runs [100, 400), resolving at 400.
    display.drawImage([markerFrame(0), markerFrame(1), markerFrame(2)], 100, 100, () => {
      completedAt = 1;
    });
    // Frame 0 painted at dispatch.
    assert.equal(display.getPixelValue(0, 0), 255);
    assert.equal(display.isBusy(), true);

    // At 200 the second frame is due.
    display.advanceScroll(200);
    assert.equal(display.getPixelValue(0, 0), 0);
    assert.equal(display.getPixelValue(1, 0), 255);
    assert.equal(completedAt, undefined);

    // At 300 the third (final) frame is due; still under lease.
    display.advanceScroll(300);
    assert.equal(display.getPixelValue(2, 0), 255);
    assert.equal(completedAt, undefined);

    // The lease elapses at 400; the final frame persists.
    display.advanceScroll(400);
    assert.equal(completedAt, 1);
    assert.equal(display.isBusy(), false);
    assert.equal(display.getPixelValue(2, 0), 255);
  });

  test("a zero-duration multi-image draw paints only the last frame and takes no lease", () => {
    const display = new MicroBitDisplay();
    let completed = false;

    display.drawImage([markerFrame(0), markerFrame(1), markerFrame(2)], 0, 0, () => {
      completed = true;
    });
    // Only the last frame is painted; no lease is held and it resolves at once.
    assert.equal(display.getPixelValue(2, 0), 255);
    assert.equal(display.getPixelValue(0, 0), 0);
    assert.equal(completed, true);
    assert.equal(display.isBusy(), false);
  });

  test("a sequence dispatched while the display is busy is silently dropped", () => {
    const display = new MicroBitDisplay();
    let dropped = false;

    display.drawImage([markerFrame(0), markerFrame(1)], 100, 0, () => {});
    // The display is now busy; a second sequence is dropped (nothing painted, resolves at once).
    display.drawImage([markerFrame(3), markerFrame(4)], 100, 0, () => {
      dropped = true;
    });
    assert.equal(dropped, true);
    assert.equal(display.getPixelValue(3, 0), 0);
    assert.equal(display.getPixelValue(4, 0), 0);
  });
});
