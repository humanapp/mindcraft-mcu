import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Button } from "./button";
import type { MicroBitEvent } from "./event";
import {
  DEVICE_BUTTON_SIMPLE_EVENTS,
  MICROBIT_BUTTON_EVT_CLICK,
  MICROBIT_BUTTON_EVT_DOWN,
  MICROBIT_BUTTON_EVT_UP,
  MICROBIT_ID_BUTTON_A,
  MICROBIT_ID_BUTTON_AB,
  MICROBIT_ID_BUTTON_B,
} from "./event";
import { MessageBus } from "./message-bus";
import { MultiButton } from "./multi-button";

describe("Button", () => {
  it("emits down, up, and click events after a press cycle", () => {
    const bus = new MessageBus();
    const events: MicroBitEvent[] = [];
    const button = new Button(MICROBIT_ID_BUTTON_A, bus);
    bus.listen(MICROBIT_ID_BUTTON_A, 0, (event) => events.push(event));

    button.setPressed(true, 10);
    button.setPressed(false, 20);
    bus.drain();

    assert.deepEqual(
      events.map((event) => [event.value, event.timestamp]),
      [
        [MICROBIT_BUTTON_EVT_DOWN, 10],
        [MICROBIT_BUTTON_EVT_UP, 20],
        [MICROBIT_BUTTON_EVT_CLICK, 20],
      ]
    );
    assert.deepEqual(button.snapshot(), { id: MICROBIT_ID_BUTTON_A, pressed: false, pressCount: 1 });
  });

  it("suppresses click events in simple event mode", () => {
    const bus = new MessageBus();
    const events: MicroBitEvent[] = [];
    const button = new Button(MICROBIT_ID_BUTTON_A, bus, DEVICE_BUTTON_SIMPLE_EVENTS);
    bus.listen(MICROBIT_ID_BUTTON_A, 0, (event) => events.push(event));

    button.setPressed(true);
    button.setPressed(false);
    bus.drain();

    assert.deepEqual(
      events.map((event) => event.value),
      [MICROBIT_BUTTON_EVT_DOWN, MICROBIT_BUTTON_EVT_UP]
    );
    assert.equal(button.snapshot().pressCount, 0);
  });
});

describe("MultiButton", () => {
  it("tracks the combined state of two source buttons", () => {
    const bus = new MessageBus();
    const events: MicroBitEvent[] = [];
    const buttonA = new Button(MICROBIT_ID_BUTTON_A, bus);
    const buttonB = new Button(MICROBIT_ID_BUTTON_B, bus);
    const buttonAB = new MultiButton(buttonA, buttonB, MICROBIT_ID_BUTTON_AB, bus);
    bus.listen(MICROBIT_ID_BUTTON_AB, 0, (event) => events.push(event));

    buttonA.setPressed(true, 1);
    buttonAB.update(1);
    buttonB.setPressed(true, 2);
    buttonAB.update(2);
    buttonA.setPressed(false, 3);
    buttonAB.update(3);
    bus.drain();

    assert.deepEqual(
      events.map((event) => [event.value, event.timestamp]),
      [
        [MICROBIT_BUTTON_EVT_DOWN, 2],
        [MICROBIT_BUTTON_EVT_UP, 3],
        [MICROBIT_BUTTON_EVT_CLICK, 3],
      ]
    );
    assert.equal(buttonAB.isPressed(), 0);
  });
});
