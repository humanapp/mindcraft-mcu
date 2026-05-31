import { CoreTypeIds, type ParameterTileInput, param } from "@mindcraft-lang/core/app";
import { WodalMicroBitV2ParameterId } from "./tile-ids";

/**
 * Shared parameter call-spec arg specs.
 *
 * Define each parameter once here and reuse it across sensors and actuators.
 * A new action should reference these shared specs rather than declaring its
 * own parameter tiles. For example, a display-clear-pixel actuator would reuse
 * {@link Param.x} and {@link Param.y}.
 */
export const Param = {
  x: param(WodalMicroBitV2ParameterId.X),
  y: param(WodalMicroBitV2ParameterId.Y),
  brightness: param(WodalMicroBitV2ParameterId.Brightness),
};

/** Parameter tiles registered once with the module. */
export const MICROBIT_V2_PARAMETERS: readonly ParameterTileInput[] = [
  { id: WodalMicroBitV2ParameterId.X, dataType: CoreTypeIds.Number, label: "x" },
  { id: WodalMicroBitV2ParameterId.Y, dataType: CoreTypeIds.Number, label: "y" },
  { id: WodalMicroBitV2ParameterId.Brightness, dataType: CoreTypeIds.Number, label: "brightness" },
];
