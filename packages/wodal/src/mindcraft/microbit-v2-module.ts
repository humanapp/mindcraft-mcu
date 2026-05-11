import type { MindcraftModule } from "@mindcraft-lang/core/app";

/** Mindcraft module ID for the WODAL microbit-v2 profile. */
export const WODAL_MICROBIT_V2_MODULE_ID = "mindcraft.microbit-v2";

/** Creates the Mindcraft module for the WODAL microbit-v2 profile. */
export function createMicroBitV2Module(): MindcraftModule {
  return {
    id: WODAL_MICROBIT_V2_MODULE_ID,
    install(): void {},
  };
}
