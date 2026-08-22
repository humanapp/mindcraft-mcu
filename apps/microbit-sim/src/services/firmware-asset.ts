/**
 * The bundled micro:bit v2 firmware, loaded as static build assets. The hex and
 * metadata are a matched pair from one firmware build (see
 * `src/assets/firmware/README.md`); both feed {@link patchFirmwareForImage} to
 * place a compiled brain into the firmware's reserved on-flash region.
 */

import type { FirmwareMetadata } from "@wendoo-lang/wodal";
import firmwareHex from "../assets/firmware/microbit-v2.hex?raw";
import firmwareMetadataJson from "../assets/firmware/microbit-v2.metadata.json";

/** The prebuilt micro:bit v2 firmware as Intel HEX text. */
export const microbitFirmwareHex: string = firmwareHex;

/** Region placement metadata emitted alongside {@link microbitFirmwareHex}. */
export const microbitFirmwareMetadata: FirmwareMetadata = firmwareMetadataJson as FirmwareMetadata;
