import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  type BrainEvents,
  BrainRuntime,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  type PlatformServices,
  type VmEvents,
} from "@mindcraft-lang/core/runtime";
import type { EventEmitterConsumer } from "@mindcraft-lang/core/util";
import { toNonNegativeInteger } from "../../../core/numeric";
import { getWodalDeviceProfile, WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import type { WodalProgramImage } from "../../../mindcraft/program-image";
import { type WodalProgramLoadValidation, WodalProgramLoadValidationCode } from "../../../mindcraft/program-load";
import { MicroBit, type MicroBitSnapshot } from "../microbit";
import type { WodalMicroBitRuntimeContext } from "./context";

/** Construction options for the WODAL runtime facade. */
export interface WodalMicroBitRuntimeOptions {
  /** Mindcraft environment with core and microbit-v2 modules installed. */
  readonly environment: MindcraftEnvironment;

  /** Simulated device. A new device is created when omitted. */
  readonly microbit?: MicroBit;

  /** Optional VM event observer for runtime diagnostics. */
  readonly vmEvents?: VmEvents;
}

/**
 * WODAL runtime facade for executing one loaded Mindcraft brain against a scoped simulated device.
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
    this.resetDevice();

    const deviceProfile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const brainRuntime = new BrainRuntime(
      program.program,
      program.pages,
      createHostServices(this.environment),
      { microbit: this.microbit } satisfies WodalMicroBitRuntimeContext,
      undefined,
      this.vmEvents,
      {
        defaultBudget: deviceProfile.defaultBudget,
        hookBudget: deviceProfile.hookBudget,
        maxFibers: deviceProfile.maxFibers,
        maxStackSize: deviceProfile.maxStackSize,
        maxLocalsSize: deviceProfile.maxLocalsSize,
        maxFrameDepth: deviceProfile.maxFrameDepth,
        maxHandlers: deviceProfile.maxHandlers,
        maxHandles: deviceProfile.maxHandles,
      }
    );
    brainRuntime.startup();

    this.loadedBrain = brainRuntime;
    return { ok: true };
  }

  /**
   * Validates and loads a WODAL program image for the runtime.
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
   * Advances simulated device time and runs the loaded brain. No-op when no program is loaded:
   * an instance can exist and be ticked by the render loop before it has been flashed.
   *
   * @param milliseconds - Elapsed simulated time in milliseconds.
   */
  tick(milliseconds: number): void {
    if (this.loadedBrain === undefined) {
      return;
    }
    this.microbit.sleep(toNonNegativeInteger(milliseconds));
    this.microbit.idleCallback();
    this.loadedBrain.think(this.microbit.systemTime());
    // Run the background sensor driver after the brain thinks, so the next
    // think's reads observe this cycle's measurement (the fixed one-cycle lag).
    this.microbit.sensorDriver.cycle();
    // Complete any scroll animations whose time has arrived. A completion
    // resolves its async handle, so the awaiting fiber resumes on the next think.
    this.microbit.display.advanceScroll(this.microbit.systemTime());
    // Complete any speaker play whose nominal duration has elapsed, the same way.
    this.microbit.speaker.advancePlay(this.microbit.systemTime());
  }

  /** Returns the current simulated device snapshot. */
  snapshot(): MicroBitSnapshot {
    return this.microbit.snapshot();
  }

  /**
   * Returns the event stream of the loaded brain, for observing page
   * activations and rule gate decisions, or `undefined` when no program is
   * loaded. Each load installs a fresh brain with its own stream, so read it
   * again after every load.
   */
  brainEvents(): EventEmitterConsumer<BrainEvents> | undefined {
    return this.loadedBrain?.events();
  }

  /** Stops the current program and resets the device to a fresh power-on state. A no-op when none is loaded. */
  unload(): void {
    if (this.loadedBrain === undefined) {
      return;
    }
    this.resetDevice();
  }

  /** Stops any running brain and resets the device to a fresh power-on state. */
  private resetDevice(): void {
    this.loadedBrain?.shutdown();
    this.loadedBrain = undefined;
    this.microbit.clear();
  }
}

function createHostServices(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}
