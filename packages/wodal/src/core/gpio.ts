/** A digital write recorded by a {@link Gpio}. */
export interface GpioDigitalWriteRecord {
  /** Pin number (0-20) the value was written to. */
  readonly pin: number;

  /** Value written: 0 for low, nonzero for high. */
  readonly value: number;
}

/** A pull-mode configuration recorded by a {@link Gpio}. */
export interface GpioPullRecord {
  /** Pin number (0-20) the pull mode was set on. */
  readonly pin: number;

  /** Pull mode: 0 none, 1 up, 2 down. */
  readonly mode: number;
}

/** A servo write recorded by a {@link Gpio}. */
export interface GpioServoRecord {
  /** Pin number (0-20) the angle was written to. */
  readonly pin: number;

  /** Servo angle in degrees, 0-180. */
  readonly angle: number;
}

/** Highest pin number addressable on the micro:bit edge connector. */
const MAX_PIN = 20;

function isValidPin(pin: number): boolean {
  return pin >= 0 && pin <= MAX_PIN;
}

/**
 * Simulated GPIO pins on the micro:bit edge connector (P0-P20). Models the pin
 * I/O the `ctx.microbit.gpio` Device API drives: `digitalRead` calls
 * {@link digitalRead}, `digitalWrite` calls {@link digitalWrite}, `setPull`
 * calls {@link setPull}, and `servoWrite` calls {@link setServo}. The model owns
 * no real hardware; it records every write, pull, and servo so a test can
 * inspect what a brain drove onto the pins, and it serves digital reads from a
 * per-pin level a test injects with {@link setDigitalRead}. A pin outside 0-20
 * is a no-op: a write/pull/servo records nothing and a read returns 0.
 */
export class Gpio {
  private readonly digitalWrites: GpioDigitalWriteRecord[] = [];
  private readonly pulls: GpioPullRecord[] = [];
  private readonly servos: GpioServoRecord[] = [];
  private readonly digitalLevels = new Map<number, number>();

  /**
   * Reads the digital level of `pin` (0-20). Returns the level a test injected
   * with {@link setDigitalRead}, 0 when none was injected, and 0 for a pin
   * outside 0-20.
   *
   * @param pin - Pin number 0-20.
   */
  digitalRead(pin: number): number {
    if (!isValidPin(pin)) {
      return 0;
    }
    return this.digitalLevels.get(pin) ?? 0;
  }

  /**
   * Writes `value` (0 low, nonzero high) to `pin` (0-20) and records the write.
   * A pin outside 0-20 records nothing. Returns 0.
   *
   * @param pin - Pin number 0-20.
   * @param value - 0 for low, nonzero for high.
   */
  digitalWrite(pin: number, value: number): number {
    if (isValidPin(pin)) {
      this.digitalWrites.push({ pin, value });
    }
    return 0;
  }

  /**
   * Sets the pull mode of `pin` (0-20) and records it. A pin outside 0-20
   * records nothing. Returns 0.
   *
   * @param pin - Pin number 0-20.
   * @param mode - Pull mode: 0 none, 1 up, 2 down.
   */
  setPull(pin: number, mode: number): number {
    if (isValidPin(pin)) {
      this.pulls.push({ pin, mode });
    }
    return 0;
  }

  /**
   * Writes a servo `angle` (0-180 degrees) to `pin` (0-20) and records it. A pin
   * outside 0-20 records nothing. Returns 0.
   *
   * @param pin - Pin number 0-20.
   * @param angle - Servo angle in degrees, 0-180.
   */
  setServo(pin: number, angle: number): number {
    if (isValidPin(pin)) {
      this.servos.push({ pin, angle });
    }
    return 0;
  }

  /**
   * Sets the digital level a {@link digitalRead} of `pin` (0-20) returns,
   * replacing any previous level. Until called for a pin, a read of it returns
   * 0. A pin outside 0-20 is ignored.
   *
   * @param pin - Pin number 0-20.
   * @param value - Level the pin returns: 0 low, nonzero high.
   */
  setDigitalRead(pin: number, value: number): void {
    if (isValidPin(pin)) {
      this.digitalLevels.set(pin, value);
    }
  }

  /** The recorded digital writes, in the order they were performed. */
  recordedDigitalWrites(): readonly GpioDigitalWriteRecord[] {
    return this.digitalWrites;
  }

  /** The recorded pull-mode configurations, in the order they were performed. */
  recordedPulls(): readonly GpioPullRecord[] {
    return this.pulls;
  }

  /** The recorded servo writes, in the order they were performed. */
  recordedServos(): readonly GpioServoRecord[] {
    return this.servos;
  }

  /** Clears all recorded writes, pulls, servos, and injected read levels, returning the pins to a fresh power-on state. */
  reset(): void {
    this.digitalWrites.length = 0;
    this.pulls.length = 0;
    this.servos.length = 0;
    this.digitalLevels.clear();
  }
}
