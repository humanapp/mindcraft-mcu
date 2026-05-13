import { Dict, type ExecutionContext, List, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  BrainRuntime,
  createCallsiteStore,
  createProgramServices,
  createRuleVariableServices,
  HandleTable,
  type LinkedBrainProgram,
  type LinkedBrainProgramJson,
  linkedBrainProgramFromJson,
  NIL_VALUE,
  type PlatformServices,
  type ProgramArtifact,
  type RuleVariableStores,
  type Scheduler,
  type Value,
  VM,
  type VmEvents,
  type VmRunResult,
} from "@mindcraft-lang/core/runtime";
import { toNonNegativeInteger } from "../../../core/numeric";
import {
  type WodalBytecodeImage,
  WodalBytecodeLoader,
  type WodalBytecodeValidation,
  WodalBytecodeValidationCode,
} from "../../../mindcraft/bytecode-loader";
import { WodalDeviceProfileId } from "../../../mindcraft/device-profile";
import { type WodalProgramImage, wodalProgramImageToBytecodeImage } from "../../../mindcraft/program-image";
import { WodalErrorCode, wodalError } from "../../../wodal-error";
import { MicroBit, type MicroBitSnapshot } from "../microbit";
import type { WodalMicroBitRuntimeContext } from "./context";

/** Construction options for the WODAL microbit-v2 runtime facade. */
export interface WodalMicroBitRuntimeOptions {
  /** Mindcraft environment with core and microbit-v2 modules installed. */
  readonly environment: MindcraftEnvironment;

  /** Simulated microbit device. A new device is created when omitted. */
  readonly microbit?: MicroBit;

  /** Instruction budget for one entry-function run. Defaults to 1000. */
  readonly instructionBudget?: number;

  /** Maximum number of pending async handles. Defaults to 100. */
  readonly maxHandles?: number;

  /** Optional VM event observer for runtime diagnostics. */
  readonly vmEvents?: VmEvents;
}

interface LoadedMicroBitProgram {
  readonly program: ProgramArtifact;
  readonly vm: VM;
  readonly services: PlatformServices;
  readonly handles: HandleTable;
  readonly variables: List<Value | undefined>;
  readonly variableSlotsByName: Dict<string, number>;
  tickCount: number;
  previousTime: number;
}

/**
 * WODAL runtime facade for executing one loaded Mindcraft program against a
 * scoped simulated microbit-v2 device.
 */
export class WodalMicroBitRuntime {
  /** Simulated device visible to WODAL host calls. */
  public readonly microbit: MicroBit;

  private readonly environment: MindcraftEnvironment;
  private readonly instructionBudget: number;
  private readonly maxHandles: number;
  private readonly vmEvents: VmEvents | undefined;
  private readonly bytecodeLoader = new WodalBytecodeLoader();
  private loaded: LoadedMicroBitProgram | undefined;
  private loadedBrain: BrainRuntime | undefined;

  /**
   * Creates a runtime facade.
   *
   * @param options - Environment, device, and execution tunables.
   */
  constructor(options: WodalMicroBitRuntimeOptions) {
    this.environment = options.environment;
    this.microbit = options.microbit ?? new MicroBit();
    this.instructionBudget = options.instructionBudget ?? 1000;
    this.maxHandles = options.maxHandles ?? 100;
    this.vmEvents = options.vmEvents;
  }

  /**
   * Loads a compiled Mindcraft program artifact.
   *
   * @param program - Program artifact produced by the web compiler/linker.
   */
  loadProgram(program: ProgramArtifact): void {
    const loadedProgram = this.createLoadedProgram(program);
    this.loadedBrain?.shutdown();
    this.loadedBrain = undefined;
    this.loaded = loadedProgram;
  }

  private createLoadedProgram(program: ProgramArtifact): LoadedMicroBitProgram {
    const callsiteStore = createCallsiteStore();
    const ruleVariableStores: RuleVariableStores = new Dict<number, Dict<string, Value>>();
    const variables = createVariableSlots(program);
    const variableSlotsByName = createVariableSlotMap(program);
    const services = createRuntimeServices(this.environment, program, callsiteStore, ruleVariableStores, {
      variables,
      variableSlotsByName,
    });
    const handles = new HandleTable(this.maxHandles);
    const vm = new VM(program, services, { handles, events: this.vmEvents });

    return {
      program,
      vm,
      services,
      handles,
      variables,
      variableSlotsByName,
      tickCount: 0,
      previousTime: this.microbit.systemTime(),
    };
  }

  /**
   * Validates and loads a bytecode image for the microbit-v2 runtime.
   *
   * @param image - Bytecode image produced by the web compiler/linker.
   * @returns Validation result from the bytecode loader.
   */
  loadImage(image: WodalBytecodeImage): WodalBytecodeValidation {
    const validation = this.bytecodeLoader.validate(image);
    if (!validation.ok) {
      return validation;
    }

    this.loadProgram(image.program as ProgramArtifact);
    return this.bytecodeLoader.load(image);
  }

  /**
   * Validates and loads a linked Mindcraft brain program for the microbit-v2 runtime.
   *
   * @param image - Bytecode image containing a core linked brain program.
   * @returns Validation result from the bytecode loader.
   */
  loadBrainImage(image: WodalBytecodeImage<LinkedBrainProgram>): WodalBytecodeValidation {
    const validation = this.bytecodeLoader.validate(image);
    if (!validation.ok) {
      return validation;
    }

    const brainRuntime = new BrainRuntime(
      image.program.program,
      image.program.pages,
      createHostServices(this.environment),
      { microbit: this.microbit } satisfies WodalMicroBitRuntimeContext,
      undefined,
      this.vmEvents
    );
    brainRuntime.startup();

    this.loadedBrain?.shutdown();
    this.loadedBrain = brainRuntime;
    this.loaded = undefined;
    return this.bytecodeLoader.load(image);
  }

  /**
   * Validates and loads a WODAL program image for the microbit-v2 runtime.
   *
   * @param image - Program image with an embedded WODAL profile id.
   * @returns Validation result from the runtime load path.
   */
  loadWodalProgramImage(image: WodalProgramImage<LinkedBrainProgram>): WodalBytecodeValidation {
    if (image.profileId !== WodalDeviceProfileId.MICROBIT_V2) {
      return {
        ok: false,
        errors: [
          {
            code: WodalBytecodeValidationCode.UNSUPPORTED_DEVICE_PROFILE,
            message: "Program image profile is not supported by the microbit-v2 runtime.",
          },
        ],
      };
    }

    return this.loadBrainImage(wodalProgramImageToBytecodeImage(image));
  }

  /**
   * Validates, hydrates, and loads a serialized linked brain program image.
   *
   * @param image - Program image with a JSON-safe linked brain payload.
   * @returns Validation result from the runtime load path.
   */
  loadSerializedWodalProgramImage(image: WodalProgramImage<LinkedBrainProgramJson>): WodalBytecodeValidation {
    return this.loadWodalProgramImage({
      ...image,
      program: linkedBrainProgramFromJson(image.program),
    });
  }

  /**
   * Runs the loaded program entry function once.
   *
   * @returns VM run result for the entry-fiber slice.
   */
  runOnce(): VmRunResult {
    const loaded = this.getLoadedProgram();
    const time = this.microbit.systemTime();
    const executionContext = createExecutionContext(loaded, this.microbit, time);
    const fiber = loaded.vm.spawnFiber(1, loaded.program.entryFuncId, List.empty<Value>(), executionContext);
    fiber.instrBudget = this.instructionBudget;

    return loaded.vm.runFiber(fiber, createScheduler());
  }

  /**
   * Advances simulated device time and runs one program entry slice.
   *
   * @param milliseconds - Elapsed simulated time in milliseconds.
   * @returns VM run result for the entry-fiber slice.
   */
  tick(milliseconds: number): VmRunResult | undefined {
    this.getLoadedRuntime();
    this.microbit.sleep(toNonNegativeInteger(milliseconds));
    this.microbit.idleCallback();
    if (this.loadedBrain !== undefined) {
      this.loadedBrain.think(this.microbit.systemTime());
      return undefined;
    }
    return this.runOnce();
  }

  /** Returns the current simulated device snapshot. */
  snapshot(): MicroBitSnapshot {
    return this.microbit.snapshot();
  }

  private getLoadedProgram(): LoadedMicroBitProgram {
    if (this.loaded === undefined) {
      throw wodalError(WodalErrorCode.MISSING_WODAL_PROGRAM, "No WODAL microbit program has been loaded.");
    }
    return this.loaded;
  }

  private getLoadedRuntime(): void {
    if (this.loaded === undefined && this.loadedBrain === undefined) {
      throw wodalError(WodalErrorCode.MISSING_WODAL_PROGRAM, "No WODAL microbit program has been loaded.");
    }
  }
}

interface VariableStorage {
  readonly variables: List<Value | undefined>;
  readonly variableSlotsByName: Dict<string, number>;
}

function createRuntimeServices(
  environment: MindcraftEnvironment,
  program: ProgramArtifact,
  callsiteStore: ReturnType<typeof createCallsiteStore>,
  ruleVariableStores: RuleVariableStores,
  variableStorage: VariableStorage
): PlatformServices {
  const { runtime, shared, app } = environment.brainServices;
  return {
    runtime,
    shared,
    app,
    brain: {
      program: createProgramServices(program),
      brainVars: createBrainVariableServices(variableStorage),
      ruleVars: createRuleVariableServices(program, ruleVariableStores),
      pages: createPageServices(),
      callsite: callsiteStore,
    },
  };
}

function createHostServices(environment: MindcraftEnvironment): Omit<PlatformServices, "brain"> {
  const { runtime, shared, app } = environment.brainServices;
  return { runtime, shared, app };
}

function createBrainVariableServices(variableStorage: VariableStorage): PlatformServices["brain"]["brainVars"] {
  return {
    getByName(name: string): Value {
      const slotId = variableStorage.variableSlotsByName.get(name);
      if (slotId === undefined || slotId >= variableStorage.variables.size()) {
        return NIL_VALUE;
      }
      return variableStorage.variables.get(slotId) ?? NIL_VALUE;
    },
    setByName(name: string, value: Value): void {
      const existingSlot = variableStorage.variableSlotsByName.get(name);
      if (existingSlot !== undefined) {
        variableStorage.variables.set(existingSlot, value);
        return;
      }
      const newSlot = variableStorage.variables.size();
      variableStorage.variables.push(value);
      variableStorage.variableSlotsByName.set(name, newSlot);
    },
    clearByName(name: string): void {
      const slotId = variableStorage.variableSlotsByName.get(name);
      if (slotId !== undefined && slotId < variableStorage.variables.size()) {
        variableStorage.variables.set(slotId, undefined);
      }
    },
  };
}

function createPageServices(): PlatformServices["brain"]["pages"] {
  return {
    getCurrentPageId: () => "",
    getPreviousPageId: () => "",
    requestPageChange: () => {},
    requestPageChangeByPageId: () => {},
    requestPageRestart: () => {},
  };
}

function createExecutionContext(loaded: LoadedMicroBitProgram, microbit: MicroBit, time: number): ExecutionContext {
  const previousTime = loaded.previousTime;
  loaded.previousTime = time;
  loaded.tickCount += 1;

  return {
    services: loaded.services,
    getVariableBySlot(slotId: number): Value {
      if (slotId < 0 || slotId >= loaded.variables.size()) {
        return NIL_VALUE;
      }
      return loaded.variables.get(slotId) ?? NIL_VALUE;
    },
    setVariableBySlot(slotId: number, value: Value): void {
      if (slotId < 0) {
        return;
      }
      while (loaded.variables.size() <= slotId) {
        loaded.variables.push(undefined);
      }
      loaded.variables.set(slotId, value);
    },
    data: { microbit } satisfies WodalMicroBitRuntimeContext,
    time,
    dt: Math.max(0, time - previousTime),
    currentTick: loaded.tickCount,
  };
}

function createScheduler(): Scheduler {
  return {
    onHandleCompleted: () => {},
    enqueueRunnable: () => {},
    getFiber: () => undefined,
  };
}

function createVariableSlots(program: ProgramArtifact): List<Value | undefined> {
  const variables = List.empty<Value | undefined>();
  for (let i = 0; i < program.variableNames.size(); i++) {
    variables.push(undefined);
  }
  return variables;
}

function createVariableSlotMap(program: ProgramArtifact): Dict<string, number> {
  const slots = new Dict<string, number>();
  for (let i = 0; i < program.variableNames.size(); i++) {
    slots.set(program.variableNames.get(i), i);
  }
  return slots;
}
