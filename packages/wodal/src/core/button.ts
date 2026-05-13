import {
  DEVICE_BUTTON_ALL_EVENTS,
  DEVICE_BUTTON_EVT_CLICK,
  DEVICE_BUTTON_EVT_DOWN,
  DEVICE_BUTTON_EVT_UP,
  type DeviceButtonEventConfiguration,
} from "./event";
import type { MessageBus } from "./message-bus";
import { toUint16, toUint32 } from "./numeric";

/** Snapshot of a simulated button's observable state. */
export interface ButtonSnapshot {
  /** Event source ID assigned to this button. */
  readonly id: number;

  /** True when the button is currently pressed. */
  readonly pressed: boolean;

  /** Number of completed press/release cycles since construction or reset. */
  readonly pressCount: number;
}

/**
 * CODAL-style button model backed by explicit simulated input.
 *
 * Call {@link setPressed} from an input adapter, then drain the owning message
 * bus from the host loop.
 */
export class Button {
  private pressed = false;
  private pressCount = 0;
  private eventConfiguration: DeviceButtonEventConfiguration;

  /**
   * Creates a button bound to a message bus source ID.
   *
   * @param id - Event source ID for this button.
   * @param messageBus - Bus that receives button events.
   * @param eventConfiguration - Button event set to emit.
   */
  constructor(
    id: number,
    private readonly messageBus: MessageBus,
    eventConfiguration: DeviceButtonEventConfiguration = DEVICE_BUTTON_ALL_EVENTS
  ) {
    this.id = toUint16(id);
    this.eventConfiguration = eventConfiguration;
  }

  /** Event source ID for this button. */
  public readonly id: number;

  /** Returns 1 when the button is currently pressed, otherwise 0. */
  isPressed(): number {
    return this.pressed ? 1 : 0;
  }

  /**
   * Changes the button event set.
   *
   * @param eventConfiguration - Event set used for future transitions.
   */
  setEventConfiguration(eventConfiguration: DeviceButtonEventConfiguration): void {
    this.eventConfiguration = eventConfiguration;
  }

  /**
   * Applies simulated input state.
   *
   * @param pressed - True when the button is pressed.
   * @param timestamp - Runtime timestamp in milliseconds.
   */
  setPressed(pressed: boolean, timestamp = 0): void {
    if (this.pressed === pressed) {
      return;
    }

    this.pressed = pressed;
    this.messageBus.fire(this.id, pressed ? DEVICE_BUTTON_EVT_DOWN : DEVICE_BUTTON_EVT_UP, timestamp);

    if (!pressed && this.eventConfiguration === DEVICE_BUTTON_ALL_EVENTS) {
      this.pressCount = toUint32(this.pressCount + 1);
      this.messageBus.fire(this.id, DEVICE_BUTTON_EVT_CLICK, timestamp);
    }
  }

  /** Resets transient state without emitting events. */
  reset(): void {
    this.pressed = false;
    this.pressCount = 0;
  }

  /** Returns a serializable view of the button state. */
  snapshot(): ButtonSnapshot {
    return {
      id: this.id,
      pressed: this.pressed,
      pressCount: this.pressCount,
    };
  }
}
