import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import { toNonNegativeInteger } from "../../../core/numeric";
import { WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import type { WodalProgramImage } from "../../../mindcraft/program-image";
import { type WodalProgramLoadValidation, WodalProgramLoadValidationCode } from "../../../mindcraft/program-load";
import { WodalErrorCode, wodalError } from "../../../wodal-error";
import { MicroBit, type MicroBitSnapshot } from "../microbit";
import type { WodalMicroBitRuntimeContext } from "./context";

/** Construction options for the WODAL microbit-v2 runtime facade. */
export interface WodalMicroBitRuntimeOptions {
  /** Mindcraft environment with core and microbit-v2 modules installed. */
  readonly environment: MindcraftEnvironment;

  /** Simulated microbit device. A new device is created when omitted. */
  readonly microbit?: MicroBit;

  /** Optional VM event observer for runtime diagnostics. */
  readonly vmEvents?: VmEvents;
}

/**
 * WODAL runtime facade for executing one loaded Mindcraft brain against a scoped simulated microbit-v2 device.
 */
export class WodalMicroBitRuntime {
  /** Simulated device visible to WODAL host calls. */
  public readonly microbit: MicroBit;

  private readonly environment: MindcraftEnvironment;
  private readonly vmEvents: VmEvents | undefined;
  private loadedBrain: BrainRuntime | undefined;

  /**
   * Creates a runtime facade.
   *
   * @param options - Environment, device, and execution tunables.
   */
  constructor(options: WodalMicroBitRuntimeOptions) {
    this.environment = options.environment;
    this.microbit = options.microbit ?? new MicroBit();
    this.vmEvents = options.vmEvents;
  }

  private loadLinkedBrainProgram(program: LinkedBrainProgram): WodalProgramLoadValidation {
    const brainRuntime = new BrainRuntime(
      program.program,
      program.pages,
      createHostServices(this.environment),
      { microbit: this.microbit } satisfies WodalMicroBitRuntimeContext,
      undefined,
      this.vmEvents
    );
    brainRuntime.startup();

    this.replaceLoadedBrain(brainRuntime);
    return { ok: true };
  }

  /**
   * Validates and loads a WODAL program image for the microbit-v2 runtime.
   *
   * @param image - Program image with an embedded WODAL profile id.
   * @returns Validation result from the runtime load path.
   */
  loadWodalProgramImage(image: WodalProgramImage<LinkedBrainProgram>): WodalProgramLoadValidation {
    if (image.profileId !== WodalDeviceProfileId.MICROBIT_V2) {
      return {
        ok: false,
        errors: [
          {
            code: WodalProgramLoadValidationCode.UNSUPPORTED_DEVICE_PROFILE,
            message: "Program image profile is not supported by the microbit-v2 runtime.",
          },
        ],
      };
    }

    return this.loadLinkedBrainProgram(image.program);
  }

  /**
   * Validates, hydrates, and loads a serialized linked brain program image.
   *
   * @param image - Program image with a JSON-safe linked brain payload.
   * @returns Validation result from the runtime load path.
   */
  loadSerializedWodalProgramImage(image: WodalProgramImage<LinkedBrainProgramJson>): WodalProgramLoadValidation {
    if (image.profileId !== WodalDeviceProfileId.MICROBIT_V2) {
      return {
        ok: false,
        errors: [
          {
            code: WodalProgramLoadValidationCode.UNSUPPORTED_DEVICE_PROFILE,
            message: "Program image profile is not supported by the microbit-v2 runtime.",
          },
        ],
      };
    }

    let program: LinkedBrainProgram;
    try {
      program = linkedBrainProgramFromJson(image.program);
    } catch (cause) {
      return {
        ok: false,
        errors: [
          {
            code: WodalProgramLoadValidationCode.INVALID_SERIALIZED_PROGRAM,
            message: "Serialized linked brain program could not be hydrated.",
            cause,
          },
        ],
      };
    }

    return this.loadLinkedBrainProgram(program);
  }

  /**
   * Advances simulated device time and runs the loaded brain.
   *
   * @param milliseconds - Elapsed simulated time in milliseconds.
   */
  tick(milliseconds: number): void {
    const loadedBrain = this.getLoadedBrain();
    this.microbit.sleep(toNonNegativeInteger(milliseconds));
    this.microbit.idleCallback();
    loadedBrain.think(this.microbit.systemTime());
  }

  /** Returns the current simulated device snapshot. */
  snapshot(): MicroBitSnapshot {
    return this.microbit.snapshot();
  }

  private getLoadedBrain(): BrainRuntime {
    if (this.loadedBrain === undefined) {
      throw wodalError(WodalErrorCode.MISSING_WODAL_PROGRAM, "No WODAL microbit program has been loaded.");
    }
    return this.loadedBrain;
  }

  private replaceLoadedBrain(brain: BrainRuntime): void {
    this.loadedBrain?.shutdown();
    this.loadedBrain = brain;
  }
}

function createHostServices(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}
