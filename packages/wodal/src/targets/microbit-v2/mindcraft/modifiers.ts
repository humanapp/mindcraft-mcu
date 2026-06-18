import { type ModifierTileInput, mod } from "@mindcraft-lang/core/app";
import { WodalMicroBitV2ModifierId } from "./tile-ids";

/**
 * Shared modifier call-spec arg specs, defined once and reused across the
 * sensor and actuator tiles of this module.
 */
export const Modifier = {
  pressed: mod(WodalMicroBitV2ModifierId.Pressed),
  released: mod(WodalMicroBitV2ModifierId.Released),
  click: mod(WodalMicroBitV2ModifierId.Click),
  doubleClick: mod(WodalMicroBitV2ModifierId.DoubleClick),
  longClick: mod(WodalMicroBitV2ModifierId.LongClick),
  held: mod(WodalMicroBitV2ModifierId.Held),
};

/** Modifier tiles registered once with the module. */
export const MICROBIT_V2_MODIFIERS: readonly ModifierTileInput[] = [
  { id: WodalMicroBitV2ModifierId.Pressed, label: "pressed" },
  { id: WodalMicroBitV2ModifierId.Released, label: "released" },
  { id: WodalMicroBitV2ModifierId.Click, label: "click" },
  { id: WodalMicroBitV2ModifierId.DoubleClick, label: "double click" },
  { id: WodalMicroBitV2ModifierId.LongClick, label: "long click" },
  { id: WodalMicroBitV2ModifierId.Held, label: "held" },
];
