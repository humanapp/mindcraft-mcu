import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WodalEvent } from "../../core/event";
import { MICROBIT_BUTTON_EVT_CLICK, MICROBIT_BUTTON_EVT_DOWN, MICROBIT_BUTTON_EVT_UP } from "./constants";
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
    const events: WodalEvent[] = [];
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

  it("applies host light-level input through the display and resets it on clear", () => {
    const microbit = new MicroBit();

    // A fresh device rests at the default reading.
    assert.equal(microbit.display.getLightLevel(), 128);

    microbit.setLightLevel(200);
    assert.equal(microbit.display.getLightLevel(), 200);

    // Out-of-range input is clamped through the convenience setter.
    microbit.setLightLevel(1000);
    assert.equal(microbit.display.getLightLevel(), 255);

    // Resetting the device returns the reading to the default.
    microbit.clear();
    assert.equal(microbit.display.getLightLevel(), 128);
  });

  it("applies host temperature input through the thermometer and resets it on clear", () => {
    const microbit = new MicroBit();

    // A fresh device rests at the default reading.
    assert.equal(microbit.thermometer.getTemperature(), 21);

    microbit.setTemperature(30);
    assert.equal(microbit.thermometer.getTemperature(), 30);

    // Temperature is signed and unbounded; a negative reading is preserved.
    microbit.setTemperature(-5);
    assert.equal(microbit.thermometer.getTemperature(), -5);

    // Resetting the device returns the reading to the default.
    microbit.clear();
    assert.equal(microbit.thermometer.getTemperature(), 21);
  });

  it("queues logo touch input events", () => {
    const microbit = new MicroBit();
    const events: WodalEvent[] = [];
    microbit.messageBus.listen(microbit.logo.id, 0, (event) => events.push(event));

    microbit.setLogoTouched(true);
    microbit.setLogoTouched(false);
    microbit.tick(20);

    assert.deepEqual(
      events.map((event) => event.value),
      [MICROBIT_BUTTON_EVT_DOWN, MICROBIT_BUTTON_EVT_UP, MICROBIT_BUTTON_EVT_CLICK]
    );
    assert.equal(microbit.snapshot().logo.pressed, false);
  });

  it("maps app-facing input methods to button and logo state", () => {
    const microbit = new MicroBit();
    const events: WodalEvent[] = [];
    microbit.messageBus.listen(microbit.buttonA.id, 0, (event) => events.push(event));
    microbit.messageBus.listen(microbit.buttonB.id, 0, (event) => events.push(event));
    microbit.messageBus.listen(microbit.logo.id, 0, (event) => events.push(event));

    microbit.setButtonPressed("A", true);
    assert.equal(microbit.buttonA.isPressed(), 1);
    assert.equal(microbit.buttonB.isPressed(), 0);

    microbit.setButtonPressed("B", true);
    assert.equal(microbit.buttonB.isPressed(), 1);

    microbit.setButtonPressed("A", false);
    assert.equal(microbit.buttonA.isPressed(), 0);

    microbit.setLogoTouched(true);
    assert.equal(microbit.logo.isPressed(), 1);

    assert.equal(microbit.snapshot().messageBus.queuedEventCount, 5);
    microbit.tick(20);
    assert.deepEqual(
      events.map((event) => event.value),
      [
        MICROBIT_BUTTON_EVT_DOWN,
        MICROBIT_BUTTON_EVT_DOWN,
        MICROBIT_BUTTON_EVT_UP,
        MICROBIT_BUTTON_EVT_CLICK,
        MICROBIT_BUTTON_EVT_DOWN,
      ]
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
