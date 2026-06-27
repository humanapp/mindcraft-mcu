import { Accelerometer } from "../../core/accelerometer";
import { Button, type ButtonSnapshot } from "../../core/button";
import { Gpio } from "../../core/gpio";
import { I2CBus } from "../../core/i2c-bus";
import { MessageBus, type MessageBusSnapshot } from "../../core/message-bus";
import { toUint32 } from "../../core/numeric";
import { Timer } from "../../core/timer";
import { TouchButton, type TouchButtonSnapshot } from "../../core/touch-button";
import { NRF52FlashManager, type NRF52FlashSnapshot } from "../../nrf52/nrf52-flash-manager";
import { NRF52Serial, type NRF52SerialSnapshot } from "../../nrf52/nrf52-serial";
import { MICROBIT_ID_BUTTON_A, MICROBIT_ID_BUTTON_B, MICROBIT_ID_LOGO } from "./constants";
import { MicroBitDisplay } from "./microbit-display";

/** Snapshot of the device state exposed to app adapters. */
export interface MicroBitSnapshot {
  /** Runtime time in milliseconds since simulated reset. */
  readonly time: number;

  /** State of button A. */
  readonly buttonA: ButtonSnapshot;

  /** State of button B. */
  readonly buttonB: ButtonSnapshot;

  /** State of the capacitive touch logo. */
  readonly logo: TouchButtonSnapshot;

  /** Current LED matrix state. */
  readonly display: ReturnType<MicroBitDisplay["snapshot"]>;

  /** Message bus queue and listener counts. */
  readonly messageBus: MessageBusSnapshot;

  /** Serial buffer state. */
  readonly serial: NRF52SerialSnapshot;

  /** Flash dimensions. */
  readonly flash: NRF52FlashSnapshot;
}

/** CODAL-style aggregate representing the microbit v2 device. */
export class MicroBit {
  /** High-level timer API backed by simulated runtime time. */
  public readonly timer = new Timer();

  /** Event bus used by device components. */
  public readonly messageBus = new MessageBus();

  /** Serial interface for byte-stream integration. */
  public readonly serial = new NRF52Serial();

  /** Simulated internal flash. */
  public readonly internalFlash = new NRF52FlashManager();

  /** Simulated USB-visible flash manager. */
  public readonly flash = new NRF52FlashManager();

  /** LED matrix display. */
  public readonly display = new MicroBitDisplay();

  /** Front button A. */
  public readonly buttonA = new Button(MICROBIT_ID_BUTTON_A, this.messageBus);

  /** Front button B. */
  public readonly buttonB = new Button(MICROBIT_ID_BUTTON_B, this.messageBus);

  /** Capacitive touch logo button. */
  public readonly logo = new TouchButton(MICROBIT_ID_LOGO, this.messageBus);

  /** Three-axis accelerometer model. */
  public readonly accelerometer = new Accelerometer();

  /** External I2C bus on the edge connector (pins P19/P20). */
  public readonly i2c = new I2CBus();

  /** GPIO pins on the edge connector (P0-P20). */
  public readonly gpio = new Gpio();

  private initialized = false;

  /** Completes device initialization. Returns 0 on first call and -1 afterward. */
  init(): number {
    if (this.initialized) {
      return -1;
    }
    this.initialized = true;
    return 0;
  }

  /**
   * Advances simulated time.
   *
   * @param milliseconds - Delay duration in milliseconds.
   */
  sleep(milliseconds: number): void {
    this.timer.advance(toUint32(milliseconds));
  }

  /** Returns runtime time in milliseconds since simulated reset. */
  systemTime(): number {
    return this.timer.systemTime();
  }

  /** Performs idle work for the scheduler-facing API. */
  schedulerIdle(): void {
    this.messageBus.drain();
  }

  /** Performs periodic idle work for the device aggregate. */
  idleCallback(): void {
    this.schedulerIdle();
  }

  /**
   * Resets the device to a fresh power-on state: clears the display, releases the buttons and logo,
   * resets the accelerometer, I2C bus, GPIO pins, timer, message bus, and serial buffers, and marks
   * the device uninitialized. Persistent flash storage is not reset.
   */
  clear(): void {
    this.timer.reset();
    this.messageBus.clear();
    this.display.reset();
    this.serial.clear();
    this.buttonA.reset();
    this.buttonB.reset();
    this.logo.reset();
    this.accelerometer.reset();
    this.i2c.reset();
    this.gpio.reset();
    this.initialized = false;
  }

  /**
   * Clears simulated user storage.
   *
   * @param forceErase - Accepted for API parity.
   */
  eraseUserStorage(forceErase = false): void {
    if (forceErase) {
      this.internalFlash.erasePage(0);
    }
  }

  /**
   * Applies host-provided button input.
   *
   * @param name - Button name.
   * @param pressed - True when the button is pressed.
   */
  setButtonPressed(name: "A" | "B", pressed: boolean): void {
    const timestamp = this.systemTime();
    if (name === "A") {
      this.buttonA.setPressed(pressed, timestamp);
    } else {
      this.buttonB.setPressed(pressed, timestamp);
    }
  }

  /**
   * Applies host-provided logo touch input.
   *
   * @param touched - True when the logo is touched.
   */
  setLogoTouched(touched: boolean): void {
    this.logo.setTouched(touched, this.systemTime());
  }

  /**
   * Advances runtime time and drains queued events.
   *
   * @param milliseconds - Runtime time in milliseconds.
   */
  tick(milliseconds: number): void {
    this.timer.setTime(toUint32(milliseconds));
    this.messageBus.drain();
  }

  /** Returns a serializable view of the device state. */
  snapshot(): MicroBitSnapshot {
    return {
      time: this.systemTime(),
      buttonA: this.buttonA.snapshot(),
      buttonB: this.buttonB.snapshot(),
      logo: this.logo.snapshot(),
      display: this.display.snapshot(),
      messageBus: this.messageBus.snapshot(),
      serial: this.serial.snapshot(),
      flash: this.flash.snapshot(),
    };
  }
}
