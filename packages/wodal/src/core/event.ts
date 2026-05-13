import { toUint16, toUint32 } from "./numeric";

/** Matches any event source or value in a message bus listener. */
export const WODAL_EVT_ANY = 0;

/** Matches any event source in a message bus listener. */
export const WODAL_ID_ANY = 0;

/** Button transition event emitted when a button becomes pressed. */
export const DEVICE_BUTTON_EVT_DOWN = 1;

/** Button transition event emitted when a button becomes released. */
export const DEVICE_BUTTON_EVT_UP = 2;

/** Button click event emitted after a press and release cycle. */
export const DEVICE_BUTTON_EVT_CLICK = 3;

/** Button long-click event value reserved by the button API. */
export const DEVICE_BUTTON_EVT_LONG_CLICK = 4;

/** Button hold event value reserved by the button API. */
export const DEVICE_BUTTON_EVT_HOLD = 5;

/** Button double-click event value reserved by the button API. */
export const DEVICE_BUTTON_EVT_DOUBLE_CLICK = 6;

/** Event configuration that emits only down and up transitions. */
export const DEVICE_BUTTON_SIMPLE_EVENTS = 1;

/** Event configuration that emits down, up, click, hold, and multi-click events. */
export const DEVICE_BUTTON_ALL_EVENTS = 2;

/** Describes which button events a simulated button should emit. */
export type DeviceButtonEventConfiguration = typeof DEVICE_BUTTON_SIMPLE_EVENTS | typeof DEVICE_BUTTON_ALL_EVENTS;

/** Numeric event emitted by a CODAL-style device component. */
export class WodalEvent {
  /** Numeric ID of the component that produced the event. */
  public readonly source: number;

  /** Numeric event value whose meaning is defined by the source component. */
  public readonly value: number;

  /** Runtime timestamp in milliseconds when the event was created. */
  public readonly timestamp: number;

  /**
   * Creates an event for delivery through a message bus.
   *
   * @param source - Numeric component source ID.
   * @param value - Numeric source-specific event value.
   * @param timestamp - Runtime timestamp in milliseconds.
   */
  constructor(source: number, value: number, timestamp = 0) {
    this.source = toUint16(source);
    this.value = toUint16(value);
    this.timestamp = toUint32(timestamp);
  }
}

/** Function invoked for a delivered message bus event. */
export type WodalEventHandler = (event: WodalEvent) => void;
