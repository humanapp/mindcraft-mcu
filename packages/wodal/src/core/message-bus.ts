import { MICROBIT_EVT_ANY, MICROBIT_ID_ANY, MicroBitEvent, type MicroBitEventHandler } from "./event";
import { toNonNegativeInteger, toUint16 } from "./numeric";

interface ListenerEntry {
  readonly source: number;
  readonly value: number;
  readonly handler: MicroBitEventHandler;
}

/** Delivery mode for newly raised events. */
export type MessageBusDelivery = "queue" | "immediate";

/** Snapshot of queued and registered event state. */
export interface MessageBusSnapshot {
  /** Number of listeners currently registered with the bus. */
  readonly listenerCount: number;

  /** Number of events waiting for host-loop delivery. */
  readonly queuedEventCount: number;
}

/**
 * CODAL-style message bus for device component events.
 *
 * Events raised with the default queued delivery are delivered only when
 * {@link drain} is called by the host loop.
 */
export class MessageBus {
  private readonly listeners: ListenerEntry[] = [];
  private readonly queue: MicroBitEvent[] = [];

  /**
   * Registers a handler for a source/value pair.
   *
   * @param source - Event source ID, or `MICROBIT_ID_ANY`.
   * @param value - Event value, or `MICROBIT_EVT_ANY`.
   * @param handler - Function invoked when a matching event is delivered.
   * @returns A function that removes this listener.
   */
  listen(source: number, value: number, handler: MicroBitEventHandler): () => void {
    const entry: ListenerEntry = { source: toUint16(source), value: toUint16(value), handler };
    this.listeners.push(entry);
    return () => this.ignore(entry.source, entry.value, handler);
  }

  /**
   * Removes matching listeners from the bus.
   *
   * @param source - Event source ID used during registration.
   * @param value - Event value used during registration.
   * @param handler - Optional handler to remove a single registration.
   */
  ignore(source: number, value: number, handler?: MicroBitEventHandler): void {
    const normalizedSource = toUint16(source);
    const normalizedValue = toUint16(value);
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      const entry = this.listeners[i];
      if (
        entry.source === normalizedSource &&
        entry.value === normalizedValue &&
        (handler === undefined || entry.handler === handler)
      ) {
        this.listeners.splice(i, 1);
      }
    }
  }

  /**
   * Raises an event.
   *
   * @param event - Event to enqueue or deliver.
   * @param delivery - Delivery mode. The default preserves host-loop single entry.
   */
  send(event: MicroBitEvent, delivery: MessageBusDelivery = "queue"): void {
    if (delivery === "immediate") {
      this.deliver(event);
      return;
    }
    this.queue.push(event);
  }

  /**
   * Raises an event by source and value.
   *
   * @param source - Event source ID.
   * @param value - Source-specific event value.
   * @param timestamp - Runtime timestamp in milliseconds.
   * @param delivery - Delivery mode. The default preserves host-loop single entry.
   */
  fire(source: number, value: number, timestamp = 0, delivery: MessageBusDelivery = "queue"): void {
    this.send(new MicroBitEvent(source, value, timestamp), delivery);
  }

  /**
   * Delivers queued events in FIFO order.
   *
   * @param limit - Maximum number of queued events to deliver.
   * @returns Number of delivered events.
   */
  drain(limit = Number.POSITIVE_INFINITY): number {
    const maxEvents = Number.isFinite(limit) ? toNonNegativeInteger(limit) : Number.POSITIVE_INFINITY;
    let delivered = 0;
    while (this.queue.length > 0 && delivered < maxEvents) {
      const event = this.queue.shift();
      if (event) {
        this.deliver(event);
        delivered++;
      }
    }
    return delivered;
  }

  /** Removes all listeners and queued events. */
  clear(): void {
    this.listeners.length = 0;
    this.queue.length = 0;
  }

  /** Returns queue and listener counts for tests and UI adapters. */
  snapshot(): MessageBusSnapshot {
    return {
      listenerCount: this.listeners.length,
      queuedEventCount: this.queue.length,
    };
  }

  private deliver(event: MicroBitEvent): void {
    const listeners = this.listeners.slice();
    for (const listener of listeners) {
      const sourceMatches = listener.source === event.source || listener.source === MICROBIT_ID_ANY;
      const valueMatches = listener.value === event.value || listener.value === MICROBIT_EVT_ANY;
      if (sourceMatches && valueMatches) {
        listener.handler(event);
      }
    }
  }
}
