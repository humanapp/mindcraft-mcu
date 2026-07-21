/** Resting temperature in Celsius a fresh or reset thermometer reads. */
export const DEFAULT_TEMPERATURE = 21;

/**
 * Software thermometer model with an injectable Celsius reading. The micro:bit
 * reads its die temperature as a synchronous signed Celsius integer
 * (`uBit.thermometer.getTemperature()`); this model holds that reading as a
 * settable scalar, resting at {@link DEFAULT_TEMPERATURE} until a host sets it.
 */
export class Thermometer {
  /** Current reading in whole degrees Celsius; signed. */
  private temperature = DEFAULT_TEMPERATURE;

  /** Returns the current temperature in whole degrees Celsius; signed. */
  getTemperature(): number {
    return this.temperature;
  }

  /**
   * Sets the temperature reading, truncating toward zero to a whole degree. The
   * value is signed and unbounded; it is not clamped.
   *
   * @param celsius - Temperature in degrees Celsius.
   */
  setTemperature(celsius: number): void {
    this.temperature = Math.trunc(celsius);
  }

  /** Resets the reading to its resting default of {@link DEFAULT_TEMPERATURE}. */
  reset(): void {
    this.temperature = DEFAULT_TEMPERATURE;
  }
}
