import { Button, type ButtonSnapshot } from "./button";
import { type ButtonEventConfiguration, DEVICE_BUTTON_ALL_EVENTS } from "./event";
import type { MessageBus } from "./message-bus";
import { toInt32 } from "./numeric";

/** Snapshot of a simulated capacitive touch button's observable state. */
export interface TouchButtonSnapshot extends ButtonSnapshot {
  /** Current touch threshold. Readings at or above this value are pressed. */
  readonly threshold: number;

  /** Last touch sensor reading. */
  readonly value: number;
}

/** CODAL-style capacitive touch button backed by explicit simulated readings. */
export class TouchButton extends Button {
  private threshold: number;
  private value = 0;

  /**
   * Creates a capacitive touch button.
   *
   * @param id - Event source ID for this button.
   * @param messageBus - Bus that receives touch button events.
   * @param threshold - Initial touch threshold.
   * @param eventConfiguration - Button event set to emit.
   */
  constructor(
    id: number,
    messageBus: MessageBus,
    threshold = 1,
    eventConfiguration: ButtonEventConfiguration = DEVICE_BUTTON_ALL_EVENTS
  ) {
    super(id, messageBus, eventConfiguration);
    this.threshold = toInt32(threshold);
  }

  /** Applies a default threshold suitable for explicit touch state input. */
  calibrate(): void {
    this.threshold = 1;
  }

  /**
   * Sets the reading threshold for touch detection.
   *
   * @param threshold - Reading at or above which the button is pressed.
   */
  setThreshold(threshold: number): void {
    this.threshold = toInt32(threshold);
    this.setPressed(this.value >= this.threshold);
  }

  /** Returns the reading threshold for touch detection. */
  getThreshold(): number {
    return this.threshold;
  }

  /** Returns the last touch reading. */
  getValue(): number {
    return this.value;
  }

  /**
   * Applies a simulated capacitive touch reading.
   *
   * @param value - Touch sensor reading.
   * @param timestamp - Runtime timestamp in milliseconds.
   */
  setValue(value: number, timestamp = 0): void {
    this.value = toInt32(value);
    this.setPressed(this.value >= this.threshold, timestamp);
  }

  /**
   * Applies explicit touched state from a simulator adapter.
   *
   * @param touched - True when the logo is being touched.
   * @param timestamp - Runtime timestamp in milliseconds.
   */
  setTouched(touched: boolean, timestamp = 0): void {
    this.setValue(touched ? Math.max(1, this.threshold) : this.threshold - 1, timestamp);
  }

  /** Returns a serializable view of the touch button state. */
  override snapshot(): TouchButtonSnapshot {
    return {
      ...super.snapshot(),
      threshold: this.threshold,
      value: this.value,
    };
  }
}
