import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Button } from "./button";
import type { WodalEvent } from "./event";
import {
  DEVICE_BUTTON_EVT_CLICK,
  DEVICE_BUTTON_EVT_DOWN,
  DEVICE_BUTTON_EVT_UP,
  DEVICE_BUTTON_SIMPLE_EVENTS,
} from "./event";
import { MessageBus } from "./message-bus";
import { TouchButton } from "./touch-button";

const TEST_BUTTON_A_ID = 1;
const TEST_TOUCH_BUTTON_ID = 121;

describe("Button", () => {
  it("emits down, up, and click events after a press cycle", () => {
    const bus = new MessageBus();
    const events: WodalEvent[] = [];
    const button = new Button(TEST_BUTTON_A_ID, bus);
    bus.listen(TEST_BUTTON_A_ID, 0, (event) => events.push(event));

    button.setPressed(true, 10);
    button.setPressed(false, 20);
    bus.drain();

    assert.deepEqual(
      events.map((event) => [event.value, event.timestamp]),
      [
        [DEVICE_BUTTON_EVT_DOWN, 10],
        [DEVICE_BUTTON_EVT_UP, 20],
        [DEVICE_BUTTON_EVT_CLICK, 20],
      ]
    );
    assert.deepEqual(button.snapshot(), { id: TEST_BUTTON_A_ID, pressed: false, pressCount: 1 });
  });

  it("suppresses click events in simple event mode", () => {
    const bus = new MessageBus();
    const events: WodalEvent[] = [];
    const button = new Button(TEST_BUTTON_A_ID, bus, DEVICE_BUTTON_SIMPLE_EVENTS);
    bus.listen(TEST_BUTTON_A_ID, 0, (event) => events.push(event));

    button.setPressed(true);
    button.setPressed(false);
    bus.drain();

    assert.deepEqual(
      events.map((event) => event.value),
      [DEVICE_BUTTON_EVT_DOWN, DEVICE_BUTTON_EVT_UP]
    );
    assert.equal(button.snapshot().pressCount, 0);
  });
});

describe("TouchButton", () => {
  it("tracks readings against the touch threshold", () => {
    const bus = new MessageBus();
    const events: WodalEvent[] = [];
    const button = new TouchButton(TEST_TOUCH_BUTTON_ID, bus, 10);
    bus.listen(button.id, 0, (event) => events.push(event));

    button.setValue(9, 1);
    button.setValue(10, 2);
    button.setValue(8, 3);
    bus.drain();

    assert.equal(button.isPressed(), 0);
    assert.deepEqual(
      events.map((event) => [event.value, event.timestamp]),
      [
        [DEVICE_BUTTON_EVT_DOWN, 2],
        [DEVICE_BUTTON_EVT_UP, 3],
        [DEVICE_BUTTON_EVT_CLICK, 3],
      ]
    );
    assert.deepEqual(button.snapshot(), {
      id: TEST_TOUCH_BUTTON_ID,
      pressed: false,
      pressCount: 1,
      threshold: 10,
      value: 8,
    });
  });
});
