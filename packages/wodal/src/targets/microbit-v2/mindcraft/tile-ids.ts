/**
 * Stable identifiers for the brain action, modifier, and parameter tiles.
 *
 * These ids are the durable contract between the module and any app that
 * authors brains against it (for example the brain editor visual
 * resolver). The brain catalog keys the tiles by the derived ids returned from
 * `mkSensorTileId`, `mkActuatorTileId`, `mkModifierTileId`, and
 * `mkParameterTileId`.
 */

/** Host action (sensor/actuator) ids for the brain tile surface. */
export const WodalMicroBitV2ActionId = {
  /** Sensor: edge-triggered button A press or release. */
  ButtonA: "microbit-v2.button-a",

  /** Actuator: set a single LED pixel brightness on the 5x5 display. */
  DisplaySetPixel: "microbit-v2.display-set-pixel",
} as const;

/** Modifier tile ids that select which button A edge the sensor reports. */
export const WodalMicroBitV2ModifierId = {
  /** Report the released-to-pressed edge. Default when no modifier is present. */
  Pressed: "microbit-v2.pressed",

  /** Report the pressed-to-released edge. */
  Released: "microbit-v2.released",
} as const;

/** Parameter tile ids consumed by the actuators. */
export const WodalMicroBitV2ParameterId = {
  /** Display column index, 0 to 4. */
  X: "microbit-v2.x",

  /** Display row index, 0 to 4. */
  Y: "microbit-v2.y",

  /** LED brightness, 0 to 255. */
  Brightness: "microbit-v2.brightness",
} as const;
