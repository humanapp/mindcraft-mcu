import { ACCELEROMETER_EVT_NONE } from "../../core/accelerometer";
import {
  DEVICE_BUTTON_EVT_CLICK,
  DEVICE_BUTTON_EVT_DOUBLE_CLICK,
  DEVICE_BUTTON_EVT_DOWN,
  DEVICE_BUTTON_EVT_HOLD,
  DEVICE_BUTTON_EVT_LONG_CLICK,
  DEVICE_BUTTON_EVT_UP,
  WODAL_EVT_ANY,
  WODAL_ID_ANY,
} from "../../core/event";

/** Matches any event source or value in a message bus listener. */
export const MICROBIT_EVT_ANY = WODAL_EVT_ANY;

/** Matches any event source in a message bus listener. */
export const MICROBIT_ID_ANY = WODAL_ID_ANY;

/** Event source ID used by button A. */
export const MICROBIT_ID_BUTTON_A = 1;

/** Event source ID used by button B. */
export const MICROBIT_ID_BUTTON_B = 2;

/** Event source ID used by the touch logo. */
export const MICROBIT_ID_LOGO = 121;

/** Button transition event emitted when a button becomes pressed. */
export const MICROBIT_BUTTON_EVT_DOWN = DEVICE_BUTTON_EVT_DOWN;

/** Button transition event emitted when a button becomes released. */
export const MICROBIT_BUTTON_EVT_UP = DEVICE_BUTTON_EVT_UP;

/** Button click event emitted after a press and release cycle. */
export const MICROBIT_BUTTON_EVT_CLICK = DEVICE_BUTTON_EVT_CLICK;

/** Button long-click event value reserved by the button API. */
export const MICROBIT_BUTTON_EVT_LONG_CLICK = DEVICE_BUTTON_EVT_LONG_CLICK;

/** Button hold event value reserved by the button API. */
export const MICROBIT_BUTTON_EVT_HOLD = DEVICE_BUTTON_EVT_HOLD;

/** Button double-click event value reserved by the button API. */
export const MICROBIT_BUTTON_EVT_DOUBLE_CLICK = DEVICE_BUTTON_EVT_DOUBLE_CLICK;

/** Gesture value reported when no accelerometer gesture has been recognized. */
export const MICROBIT_ACCELEROMETER_EVT_NONE = ACCELEROMETER_EVT_NONE;

/** Fixed side length of the LED matrix. */
export const MICROBIT_LED_MATRIX_SIZE = 5;
