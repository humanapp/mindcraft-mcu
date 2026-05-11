import { toUint32 } from "./numeric";

/** Runtime clock measured in milliseconds since the simulated device reset. */
export class Timer {
  private now = 0;

  /** Returns the current runtime time in milliseconds. */
  systemTime(): number {
    return this.now;
  }

  /**
   * Sets the current runtime time.
   *
   * @param milliseconds - Monotonic runtime time in milliseconds.
   */
  setTime(milliseconds: number): void {
    this.now = toUint32(milliseconds);
  }

  /**
   * Advances the current runtime time.
   *
   * @param milliseconds - Non-negative elapsed milliseconds.
   */
  advance(milliseconds: number): void {
    this.setTime(this.now + Math.max(0, milliseconds));
  }

  /** Resets runtime time to zero. */
  reset(): void {
    this.now = 0;
  }
}
