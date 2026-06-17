import type { MindcraftModule } from "@mindcraft-lang/core/app";
import type { LinkedBrainProgram, NumberPrecision } from "@mindcraft-lang/core/runtime";
import { createMicroBitV2Module } from "../targets/microbit-v2/mindcraft/module";
import { createMicroBitV2ProgramImage } from "../targets/microbit-v2/mindcraft/program-image";
import {
  WodalDeviceProfileId as WodalDeviceProfileIds,
  type WodalDeviceProfileId as WodalDeviceProfileIdValue,
  WodalDeviceProfileNumericId,
} from "./device-profile-id";
import type { WodalProgramImage } from "./program-image";

export {
  isWodalDeviceProfileId,
  WODAL_DEVICE_PROFILE_IDS,
  WodalDeviceProfileId,
  WodalDeviceProfileNumericId,
} from "./device-profile-id";

/** Mindcraft integration metadata for a WODAL device profile. */
export interface WodalDeviceProfile {
  /** Stable profile id used in WODAL project documents and build artifacts. */
  readonly profileId: WodalDeviceProfileIdValue;

  /** Stable numeric profile id recorded in the binary `.mcprogram` envelope header. */
  readonly numericProfileId: number;

  /** Numeric precision the device runs at; drives binary `.mcprogram` number encoding and the runtime's `ProfileNumerics` selection. */
  readonly numberPrecision: NumberPrecision;

  /** Instruction budget each fiber receives per scheduler tick. Mirrored as a device build constant. */
  readonly defaultBudget: number;

  /** Instruction budget a page-lifecycle hook fiber receives. Mirrored as a device build constant. */
  readonly hookBudget: number;

  /** Maximum number of concurrently live fibers the scheduler tracks. Mirrored as a device build constant. */
  readonly maxFibers: number;

  /** Per-fiber operand-stack depth cap. Mirrored as the C++ `kMaxStackSize` guard. */
  readonly maxStackSize: number;

  /** Per-fiber total-locals depth cap. Mirrored as the C++ `kMaxLocalsSize` guard. */
  readonly maxLocalsSize: number;

  /** Per-fiber call-frame depth cap. Mirrored as the C++ `kMaxFrameDepth` guard. */
  readonly maxFrameDepth: number;

  /** Per-fiber try-handler depth cap. Mirrored as the C++ `kMaxHandlers` guard. */
  readonly maxHandlers: number;

  /** Concurrent async-handle cap. Mirrored as the C++ `maxHandles` device-profile guard. */
  readonly maxHandles: number;

  /** Creates the Mindcraft module for this profile. */
  readonly createMindcraftModule: () => MindcraftModule;

  /** Creates a WODAL program image for this profile. */
  readonly createProgramImage: (program: LinkedBrainProgram) => WodalProgramImage<LinkedBrainProgram>;
}

/** Supported WODAL device profiles keyed by profile id. */
export const WODAL_DEVICE_PROFILES = Object.freeze({
  [WodalDeviceProfileIds.MICROBIT_V2]: Object.freeze({
    profileId: WodalDeviceProfileIds.MICROBIT_V2,
    numericProfileId: WodalDeviceProfileNumericId[WodalDeviceProfileIds.MICROBIT_V2],
    numberPrecision: "f32",
    defaultBudget: 1000,
    hookBudget: 10000,
    maxFibers: 100,
    // Per-fiber overflow guards; mirrored as the C++ kMax* in
    // cpp/core/runtime/execution-state.h. The two sides must stay equal.
    maxStackSize: 256,
    maxLocalsSize: 256,
    maxFrameDepth: 64,
    maxHandlers: 16,
    maxHandles: 8,
    createMindcraftModule: createMicroBitV2Module,
    createProgramImage: createMicroBitV2ProgramImage,
  } satisfies WodalDeviceProfile),
} satisfies Readonly<Record<WodalDeviceProfileIdValue, WodalDeviceProfile>>);

/**
 * Returns Mindcraft integration metadata for a supported WODAL device profile.
 *
 * @param profileId - Supported WODAL device profile id.
 */
export function getWodalDeviceProfile(profileId: WodalDeviceProfileIdValue): WodalDeviceProfile {
  return WODAL_DEVICE_PROFILES[profileId];
}
