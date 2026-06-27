/**
 * Distance in centimeters a sonar read returns before any measurement has
 * completed, and the value a timed-out or out-of-range measurement reads as.
 * Also the ceiling a computed distance is clamped to.
 */
export const SONAR_MAX_DISTANCE_CM = 200;

/** Injected echo width meaning "no echo arrived" (a timeout / no target). */
const SONAR_NO_ECHO = -1;

/**
 * Distance in centimeters for an echo width in microseconds, using the SR04
 * formula `floor(echoMicros * 34 / 2 / 1000)`, clamped to
 * {@link SONAR_MAX_DISTANCE_CM}. A negative echo width (no echo) reads as the
 * maximum distance. The arithmetic is integer-exact so both VMs agree.
 *
 * @param echoMicros - Echo pulse width in microseconds, or negative for no echo.
 */
function sonarDistanceCm(echoMicros: number): number {
  if (echoMicros < 0) {
    return SONAR_MAX_DISTANCE_CM;
  }
  const cm = Math.floor((echoMicros * 34) / 2 / 1000);
  return cm > SONAR_MAX_DISTANCE_CM ? SONAR_MAX_DISTANCE_CM : cm;
}

/** Per-sonar state: the injected echo width and the value reads currently see. */
interface SonarState {
  /** Echo width in microseconds the next driver cycle measures; negative for no echo. */
  echoMicros: number;

  /** Distance in centimeters a read returns now: the previous driver cycle's measurement. */
  cache: number;
}

function sonarKey(trig: number, echo: number): string {
  return `${trig}:${echo}`;
}

/**
 * Logical-time model of the device's background sensor driver: the runtime
 * component that owns the measurements which cannot be performed synchronously
 * inside the VM. It services sonars keyed by their (trigger, echo) pin pair,
 * exposing each as a distance the VM reads synchronously.
 *
 * A sonar is registered on the first reference to its pin pair (by a read or an
 * injection) and stays registered until {@link reset}; any later reference to
 * the same pins reaches the same sonar. Each {@link cycle} refreshes every
 * registered sonar's cached distance from its injected echo width, and a read
 * returns the value cached by the previous cycle - a fixed one-cycle lag,
 * matching the device, where the background fiber's last completed measurement
 * is what a read sees. All reads of a sonar within one think share the one
 * cached value.
 *
 * On the device the echo width is the SR04 measurement the background fiber
 * performs; here a test or the simulator UI injects it with
 * {@link setEchoMicros}.
 */
export class SensorDriver {
  private readonly sonars = new Map<string, SonarState>();

  /**
   * Reads the cached distance in centimeters of the sonar wired to `trig`/`echo`,
   * registering it on the first reference. The value is the previous driver
   * cycle's measurement; before any cycle has measured it (the registration
   * think) the read returns {@link SONAR_MAX_DISTANCE_CM}.
   *
   * @param trig - Trigger pin number.
   * @param echo - Echo pin number.
   */
  sonarDistance(trig: number, echo: number): number {
    return this.sonar(trig, echo).cache;
  }

  /**
   * Sets the echo width in microseconds the next {@link cycle} measures for the
   * sonar wired to `trig`/`echo`, registering it on the first reference. A
   * negative width means no echo (the read reads as the maximum distance).
   *
   * @param trig - Trigger pin number.
   * @param echo - Echo pin number.
   * @param echoMicros - Echo pulse width in microseconds, or negative for no echo.
   */
  setEchoMicros(trig: number, echo: number, echoMicros: number): void {
    this.sonar(trig, echo).echoMicros = echoMicros;
  }

  /**
   * Runs one driver cycle: refreshes every registered sonar's cached distance
   * from its injected echo width. Called once per think after the brain runs, so
   * the next think's reads observe this cycle's measurement (the one-cycle lag).
   */
  cycle(): void {
    for (const sonar of this.sonars.values()) {
      sonar.cache = sonarDistanceCm(sonar.echoMicros);
    }
  }

  /** Clears all registered sonars, returning the driver to a fresh power-on state. */
  reset(): void {
    this.sonars.clear();
  }

  private sonar(trig: number, echo: number): SonarState {
    const key = sonarKey(trig, echo);
    let sonar = this.sonars.get(key);
    if (sonar === undefined) {
      sonar = { echoMicros: SONAR_NO_ECHO, cache: SONAR_MAX_DISTANCE_CM };
      this.sonars.set(key, sonar);
    }
    return sonar;
  }
}
