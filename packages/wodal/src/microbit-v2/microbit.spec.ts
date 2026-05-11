import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MicroBitEvent } from "../core/event";
import { MICROBIT_BUTTON_EVT_CLICK, MICROBIT_BUTTON_EVT_DOWN, MICROBIT_BUTTON_EVT_UP } from "../core/event";
import { MicroBit } from "./microbit";

describe("MicroBit", () => {
  it("initializes once", () => {
    const microbit = new MicroBit();

    assert.equal(microbit.init(), 0);
    assert.equal(microbit.init(), -1);
  });

  it("wraps system time to uint32", () => {
    const microbit = new MicroBit();

    microbit.tick(4294967296);
    assert.equal(microbit.systemTime(), 0);
    microbit.sleep(-1);
    assert.equal(microbit.systemTime(), 4294967295);
  });

  it("queues input events and drains them during tick", () => {
    const microbit = new MicroBit();
    const events: MicroBitEvent[] = [];
    microbit.messageBus.listen(microbit.buttonA.id, 0, (event) => events.push(event));

    microbit.setButtonPressed("A", true);
    microbit.setButtonPressed("A", false);
    assert.equal(microbit.snapshot().messageBus.queuedEventCount, 3);

    microbit.tick(20);
    assert.deepEqual(
      events.map((event) => event.value),
      [MICROBIT_BUTTON_EVT_DOWN, MICROBIT_BUTTON_EVT_UP, MICROBIT_BUTTON_EVT_CLICK]
    );
    assert.equal(microbit.snapshot().messageBus.queuedEventCount, 0);
  });

  it("reports display and serial state in snapshots", () => {
    const microbit = new MicroBit();

    microbit.display.setPixelValue(0, 0, 300);
    microbit.serial.send([256, 1]);

    const snapshot = microbit.snapshot();
    assert.equal(snapshot.display.pixels[0], 255);
    assert.deepEqual(snapshot.serial.tx, [0, 1]);
  });
});
