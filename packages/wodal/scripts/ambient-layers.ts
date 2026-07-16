import type { ITypeRegistry } from "@mindcraft-lang/core/runtime";
import { buildPlatformAmbientDeclarations } from "@mindcraft-lang/ts-compiler";

/**
 * Names of the wodal-general device types whose ambient `"mindcraft"`
 * declarations belong to the wodal layer. Every other non-core platform type
 * belongs to the concrete target layer. Buttons, touch, accelerometer, the I2C
 * and GPIO buses, sonar, the radio, and the image pixel buffer are general
 * device peripherals; the top-level device object, the LED display, and the
 * runtime `Context` stay target-bound.
 */
export const WODAL_AMBIENT_TYPE_NAMES: ReadonlySet<string> = new Set([
  "Image",
  "Button",
  "TouchButton",
  "Accelerometer",
  "I2C",
  "GPIO",
  "Sonar",
  "Radio",
  "RadioPacket",
  "RadioPacketList",
]);

/** The two layer sources a platform's non-core `"mindcraft"` types split into. */
export interface LayeredPlatformAmbients {
  /** wodal-general device surface, written to `mindcraft.codal.d.ts`. */
  wodal: string;
  /** target-specific surface, written to `mindcraft.<target>.d.ts`. */
  target: string;
}

/**
 * Splits a platform's non-core `"mindcraft"` type declarations into the
 * wodal-general layer and the target layer. Each result is a standalone
 * declaration-merging `.d.ts` source; TypeScript merges them together with the
 * core ambient into one `"mindcraft"` module. Core-struct augmentations (the
 * `Context.microbit` field) are carried by the target layer alone.
 *
 * @param coreTypes - Registry of the core Mindcraft types.
 * @param platformTypes - Registry of the full platform (core plus target).
 */
export function buildLayeredPlatformAmbients(
  coreTypes: ITypeRegistry,
  platformTypes: ITypeRegistry
): LayeredPlatformAmbients {
  const wodal = buildPlatformAmbientDeclarations(coreTypes, platformTypes, {
    includeType: (def) => WODAL_AMBIENT_TYPE_NAMES.has(def.name),
    includeAugmentations: false,
  });
  const target = buildPlatformAmbientDeclarations(coreTypes, platformTypes, {
    includeType: (def) => !WODAL_AMBIENT_TYPE_NAMES.has(def.name),
  });
  return { wodal, target };
}
