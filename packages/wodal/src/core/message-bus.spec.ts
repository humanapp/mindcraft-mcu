import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WODAL_EVT_ANY, WODAL_ID_ANY, WodalEvent } from "./event";
import { MessageBus } from "./message-bus";

describe("MessageBus", () => {
  it("queues events until drained", () => {
    const bus = new MessageBus();
    const events: WodalEvent[] = [];

    bus.listen(1, 2, (event) => events.push(event));
    bus.fire(1, 2, 3);

    assert.equal(events.length, 0);
    assert.deepEqual(bus.snapshot(), { listenerCount: 1, queuedEventCount: 1 });
    assert.equal(bus.drain(), 1);
    assert.deepEqual(
      events.map((event) => [event.source, event.value, event.timestamp]),
      [[1, 2, 3]]
    );
  });

  it("matches wildcard source and value listeners", () => {
    const bus = new MessageBus();
    const received: string[] = [];

    bus.listen(WODAL_ID_ANY, WODAL_EVT_ANY, (event) => received.push(`${event.source}:${event.value}`));
    bus.fire(10, 20);
    bus.fire(11, 21);
    bus.drain();

    assert.deepEqual(received, ["10:20", "11:21"]);
  });

  it("normalizes event IDs to uint16", () => {
    const event = new WodalEvent(65537, -1, -1);

    assert.equal(event.source, 1);
    assert.equal(event.value, 65535);
    assert.equal(event.timestamp, 4294967295);
  });

  it("removes matching listeners", () => {
    const bus = new MessageBus();
    let calls = 0;
    const stop = bus.listen(7, 9, () => calls++);

    stop();
    bus.fire(7, 9);
    bus.drain();

    assert.equal(calls, 0);
    assert.deepEqual(bus.snapshot(), { listenerCount: 0, queuedEventCount: 0 });
  });
});
