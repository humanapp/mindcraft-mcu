/**
 * Stable identifiers for the brain action, modifier, and parameter tiles.
 *
 * These ids are the durable contract between the module and any app that
 * authors brains against it (for example the brain editor visual
 * resolver). The brain catalog keys the tiles by the derived ids returned from
 * `mkSensorTileId`, `mkActuatorTileId`, `mkModifierTileId`, and
 * `mkParameterTileId`.
 */

import type { HostActionIds } from "@mindcraft-lang/core/app";

/**
 * Stable numeric funcIds for the microbit-v2 host functions: the native
 * struct methods and the sensor/actuator function entries. `HOST_CALL`
 * dispatches by these values and serialized programs record them verbatim,
 * so an id, once assigned, is never changed or reused. All values are at or
 * above core's `TARGET_FUNC_ID_BASE`. Append new members at the next free
 * id.
 */
export enum MicroBitV2HostFuncId {
  DisplaySetPixelValue = 1024,
  DisplayGetPixelValue = 1025,
  DisplayClear = 1026,
  ButtonIsPressed = 1027,
  TouchButtonIsPressed = 1028,
  TouchButtonGetThreshold = 1029,
  TouchButtonSetThreshold = 1030,
  TouchButtonGetValue = 1031,
  TouchButtonSetValue = 1032,
  SensorButtonA = 1033,
  ActuatorDisplaySetPixel = 1034,
  ActuatorDisplayScroll = 1035,
  SensorButtonB = 1036,
  SensorButtonAB = 1037,
  SensorButtonLogo = 1038,
}

/**
 * Stable type-atom ids of the microbit-v2 native struct types. Serialized
 * programs reference nominal types by these values, so an id, once assigned,
 * is never changed or reused. All values are at or above core's
 * `TARGET_TYPE_ATOM_BASE`. Append new members at the next free id.
 */
export enum MicroBitV2TypeAtomId {
  MicroBitDisplay = 1024,
  Button = 1025,
  TouchButton = 1026,
  MicroBit = 1027,
}

/**
 * Identity records of the microbit-v2 sensors and actuators, one per host
 * action. The record is the single declaration of each action's key and
 * action id; `fnId` references the action's {@link MicroBitV2HostFuncId}
 * member. Action ids are at or above core's `TARGET_ACTION_ID_BASE` and are
 * permanent once assigned: append new records at the next free action id and
 * never renumber or reuse one.
 */
export const MicroBitV2HostActions = {
  /** Sensor: button A, deriving one button event from the polled press level. */
  ButtonA: { key: "microbit-v2.button-a", actionId: 1024, fnId: MicroBitV2HostFuncId.SensorButtonA },

  /** Actuator: set a single LED pixel brightness on the 5x5 display. */
  DisplaySetPixel: {
    key: "microbit-v2.display-set-pixel",
    actionId: 1025,
    fnId: MicroBitV2HostFuncId.ActuatorDisplaySetPixel,
  },

  /** Actuator: scroll text across the 5x5 display, awaiting the animation. */
  DisplayScroll: {
    key: "microbit-v2.display-scroll",
    actionId: 1026,
    fnId: MicroBitV2HostFuncId.ActuatorDisplayScroll,
  },

  /** Sensor: button B, deriving one button event from the polled press level. */
  ButtonB: { key: "microbit-v2.button-b", actionId: 1027, fnId: MicroBitV2HostFuncId.SensorButtonB },

  /** Sensor: buttons A and B together, pressed only while both are pressed. */
  ButtonAB: { key: "microbit-v2.button-ab", actionId: 1028, fnId: MicroBitV2HostFuncId.SensorButtonAB },

  /** Sensor: the capacitive touch logo, deriving events from the polled touch level. */
  ButtonLogo: {
    key: "microbit-v2.button-logo",
    actionId: 1029,
    fnId: MicroBitV2HostFuncId.SensorButtonLogo,
  },
} as const satisfies Record<string, HostActionIds>;

/**
 * Modifier tile ids selecting which derived button event a button sensor
 * reports. At most one is present on a tile; absent selects `click`.
 */
export const WodalMicroBitV2ModifierId = {
  /** Report the released-to-pressed edge. */
  Pressed: "microbit-v2.pressed",

  /** Report the pressed-to-released edge. */
  Released: "microbit-v2.released",

  /** Report a release whose preceding press was shorter than the long-click threshold. */
  Click: "microbit-v2.click",

  /** Report a press beginning within the double-click window after a click. */
  DoubleClick: "microbit-v2.double-click",

  /** Report a release whose preceding press was at least the long-click threshold. */
  LongClick: "microbit-v2.long-click",

  /** Report every tick the button is currently pressed (a level, not an edge). */
  Held: "microbit-v2.held",
} as const;

/** Parameter tile ids consumed by the actuators. */
export const WodalMicroBitV2ParameterId = {
  /** Display column index, 0 to 4. */
  X: "microbit-v2.x",

  /** Display row index, 0 to 4. */
  Y: "microbit-v2.y",

  /** LED brightness, 0 to 255. */
  Brightness: "microbit-v2.brightness",

  /** Text to scroll across the display. */
  Text: "microbit-v2.text",
} as const;
