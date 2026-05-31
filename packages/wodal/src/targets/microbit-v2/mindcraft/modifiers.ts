import { type ModifierTileInput, mod } from "@mindcraft-lang/core/app";
import { WodalMicroBitV2ModifierId } from "./tile-ids";

/**
 * Shared modifier call-spec arg specs.
 *
 * Define each modifier once here and reuse it across sensors and actuators.
 * A new action should reference these shared specs rather than declaring its
 * own modifier tiles.
 */
export const Modifier = {
  pressed: mod(WodalMicroBitV2ModifierId.Pressed),
  released: mod(WodalMicroBitV2ModifierId.Released),
};

/** Modifier tiles registered once with the module. */
export const MICROBIT_V2_MODIFIERS: readonly ModifierTileInput[] = [
  { id: WodalMicroBitV2ModifierId.Pressed, label: "pressed" },
  { id: WodalMicroBitV2ModifierId.Released, label: "released" },
];
