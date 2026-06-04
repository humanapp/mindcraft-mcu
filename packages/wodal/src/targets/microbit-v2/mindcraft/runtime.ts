import { List } from "@mindcraft-lang/core";
import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  type ExecutableAction,
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

    const brainRuntime = new BrainRuntime(
      program.program,
      program.pages,
      createHostServices(this.environment),
      { microbit: this.microbit } satisfies WodalMicroBitRuntimeContext,
      undefined,
      this.vmEvents
    );
    brainRuntime.startup();

    this.loadedBrain = brainRuntime;
    return { ok: true };
  }

  /**
   * Rebinds the live host action functions onto a deserialized linked program.
   *
   * A serialized linked program carries host actions as descriptor-only bindings; their
   * live functions are resolved here from the runtime environment's action registry by
   * descriptor. Bytecode actions pass through unchanged. Returns a load failure when a
   * host action's descriptor does not resolve in this environment.
   *
   * @param program - Deserialized linked program to rebind in place.
   */
  private rebindHostActions(program: LinkedBrainProgram): WodalProgramLoadValidation {
    const actions = program.program.actions;
    if (!actions) {
      return { ok: true };
    }

    const resolver = this.environment.brainServices.runtime.actions;
    const reboundActions = List.empty<ExecutableAction>();
    for (let i = 0; i < actions.size(); i++) {
      const action = actions.get(i)!;
      if (action.binding !== "host") {
        reboundActions.push(action);
        continue;
      }

      const resolved = resolver.getByKey(action.descriptor.key);
      if (!resolved || resolved.binding !== "host") {
        return {
          ok: false,
          errors: [
            {
              code: WodalProgramLoadValidationCode.UNRESOLVED_HOST_ACTION,
              message: `Host action '${action.descriptor.key}' is not registered in the runtime environment.`,
            },
          ],
        };
      }

      reboundActions.push(resolved);
    }

    program.program.actions = reboundActions;
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

    const rebound = this.rebindHostActions(program);
    if (!rebound.ok) {
      return rebound;
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
  }

  /** Returns the current simulated device snapshot. */
  snapshot(): MicroBitSnapshot {
    return this.microbit.snapshot();
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
