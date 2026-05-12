import { Dict, type ExecutionContext, List, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import {
  createCallsiteStore,
  createProgramServices,
  createRuleVariableServices,
  HandleTable,
  NIL_VALUE,
  type PlatformServices,
  type ProgramArtifact,
  type RuleVariableStores,
  type Scheduler,
  type Value,
  VM,
  type VmRunResult,
} from "@mindcraft-lang/core/runtime";
import { MicroBit, type MicroBitSnapshot } from "../microbit-v2";
import { MISSING_WODAL_PROGRAM, wodalError } from "../wodal-error";
import { type WodalBytecodeImage, WodalBytecodeLoader, type WodalBytecodeValidation } from "./bytecode-loader";
import type { WodalMicroBitRuntimeContext } from "./microbit-v2-context";

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
  private readonly bytecodeLoader = new WodalBytecodeLoader();
  private loaded: LoadedMicroBitProgram | undefined;

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
  }

  /**
   * Loads a compiled Mindcraft program artifact.
   *
   * @param program - Program artifact produced by the web compiler/linker.
   */
  loadProgram(program: ProgramArtifact): void {
    const callsiteStore = createCallsiteStore();
    const ruleVariableStores: RuleVariableStores = new Dict<number, Dict<string, Value>>();
    const variables = createVariableSlots(program);
    const variableSlotsByName = createVariableSlotMap(program);
    const services = createRuntimeServices(this.environment, program, callsiteStore, ruleVariableStores, {
      variables,
      variableSlotsByName,
    });
    const handles = new HandleTable(this.maxHandles);
    const vm = new VM(program, services, { handles });

    this.loaded = {
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

  /** Returns the current simulated device snapshot. */
  snapshot(): MicroBitSnapshot {
    return this.microbit.snapshot();
  }

  private getLoadedProgram(): LoadedMicroBitProgram {
    if (this.loaded === undefined) {
      throw wodalError(MISSING_WODAL_PROGRAM, "No WODAL microbit program has been loaded.");
    }
    return this.loaded;
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
