import { Button, type ButtonSnapshot } from "./button";
import type { DeviceButtonEventConfiguration } from "./event";
import type { MessageBus } from "./message-bus";

/** Snapshot of a simulated multi-button state. */
export interface MultiButtonSnapshot extends ButtonSnapshot {
  /** Event source ID for the first physical button in the group. */
  readonly buttonAId: number;

  /** Event source ID for the second physical button in the group. */
  readonly buttonBId: number;
}

/** Virtual button that is pressed when two source buttons are pressed together. */
export class MultiButton extends Button {
  /**
   * Creates a grouped button.
   *
   * @param buttonA - First source button.
   * @param buttonB - Second source button.
   * @param id - Event source ID for the virtual button.
   * @param messageBus - Bus that receives virtual button events.
   * @param eventConfiguration - Button event set to emit.
   */
  constructor(
    private readonly buttonA: Button,
    private readonly buttonB: Button,
    id: number,
    messageBus: MessageBus,
    eventConfiguration?: DeviceButtonEventConfiguration
  ) {
    super(id, messageBus, eventConfiguration);
  }

  /**
   * Recomputes the grouped button state from its source buttons.
   *
   * @param timestamp - Runtime timestamp in milliseconds.
   */
  update(timestamp = 0): void {
    this.setPressed(this.buttonA.isPressed() === 1 && this.buttonB.isPressed() === 1, timestamp);
  }

  /** Returns a serializable view of the grouped button state. */
  override snapshot(): MultiButtonSnapshot {
    return {
      ...super.snapshot(),
      buttonAId: this.buttonA.id,
      buttonBId: this.buttonB.id,
    };
  }
}
