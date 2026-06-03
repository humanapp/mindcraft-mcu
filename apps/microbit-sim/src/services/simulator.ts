import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { buildWodalProgramImage, type WodalBuildInput } from "@mindcraft-lang/wodal";
import { MicroBit, type MicroBitSnapshot, WodalMicroBitRuntime } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { SharedMedium } from "./shared-medium";

/** A classified flash diagnostic, carrying a stable WODAL code verbatim. */
export interface FlashDiagnostic {
  readonly code: string;
  readonly message: string;
}

/**
 * Per-instance flash outcome: `empty` before any flash, `noBrainSelected` when a flash is attempted
 * with no editor selection, `loaded` with the flashed brain id, or `failed` with classified
 * diagnostics.
 */
export type FlashState =
  | { readonly status: "empty" }
  | { readonly status: "noBrainSelected" }
  | { readonly status: "loaded"; readonly brainId: string }
  | { readonly status: "failed"; readonly errors: readonly FlashDiagnostic[] };

/**
 * One simulated microbit instance: its `MicroBit` device, the WODAL runtime bound to that device and
 * the shared Mindcraft environment, and its current flash state.
 */
export class SimulatorInstance {
  readonly id: string;
  readonly microbit: MicroBit;
  readonly runtime: WodalMicroBitRuntime;

  /** Current flash state; `empty` until a program is flashed. */
  flashState: FlashState = { status: "empty" };

  constructor(id: string, environment: MindcraftEnvironment) {
    this.id = id;
    this.microbit = new MicroBit();
    this.runtime = new WodalMicroBitRuntime({ environment, microbit: this.microbit });
  }

  /** Id of the brain currently flashed onto this instance, or undefined when none is loaded. */
  get flashedBrainId(): string | undefined {
    return this.flashState.status === "loaded" ? this.flashState.brainId : undefined;
  }

  /** Advances this instance by elapsed simulated time. A no-op until a program is loaded. */
  tick(elapsedMs: number): void {
    this.runtime.tick(elapsedMs);
  }

  /** Current device snapshot for rendering. */
  snapshot(): MicroBitSnapshot {
    return this.runtime.snapshot();
  }
}

/**
 * App-owned model of the simulated microbit fleet: the instance list, the shared medium each
 * instance registers into, and the tick driver that advances them. Construct against the shared
 * Mindcraft environment. Exposes the store subscribe/snapshot pattern for React consumers - the
 * instance list and a per-frame counter.
 */
export class MicrobitSimulator {
  private readonly environment: MindcraftEnvironment;
  private readonly medium = new SharedMedium();
  private instances_: readonly SimulatorInstance[] = [];
  private readonly instanceListeners = new Set<() => void>();
  private readonly frameListeners = new Set<() => void>();
  private frame_ = 0;
  private rafHandle: number | undefined;
  private lastFrameMs: number | undefined;

  constructor(environment: MindcraftEnvironment) {
    this.environment = environment;
    this.addInstance();
  }

  /** The shared simulated medium instances register into. */
  sharedMedium(): SharedMedium {
    return this.medium;
  }

  /** Creates an instance, registers it into the medium, and returns it. */
  addInstance(): SimulatorInstance {
    const instance = new SimulatorInstance(crypto.randomUUID(), this.environment);
    this.medium.register(instance.id);
    this.instances_ = [...this.instances_, instance];
    this.notifyInstances();
    return instance;
  }

  /** Destroys an instance, unregistering it from the medium. */
  removeInstance(id: string): void {
    if (!this.instances_.some((instance) => instance.id === id)) {
      return;
    }
    this.medium.unregister(id);
    this.instances_ = this.instances_.filter((instance) => instance.id !== id);
    this.notifyInstances();
  }

  /**
   * Builds and loads `input` onto the target instance, recording the resulting flash state.
   * Undefined `input` or `brainId` records a `noBrainSelected` state.
   */
  flash(instanceId: string, input: WodalBuildInput | undefined, brainId: string | undefined): void {
    const instance = this.instances_.find((candidate) => candidate.id === instanceId);
    if (!instance) {
      return;
    }
    if (!input || !brainId) {
      this.applyFlashState(instance, { status: "noBrainSelected" });
      return;
    }
    const built = buildWodalProgramImage(input);
    if (!built.ok) {
      this.applyFlashState(instance, {
        status: "failed",
        errors: built.errors.map((error) => ({ code: error.code, message: error.message })),
      });
      return;
    }
    const loaded = instance.runtime.loadWodalProgramImage(built.image);
    this.applyFlashState(
      instance,
      loaded.ok
        ? { status: "loaded", brainId }
        : { status: "failed", errors: loaded.errors.map((error) => ({ code: error.code, message: error.message })) }
    );
  }

  /** Advances every instance by elapsed simulated time. Unloaded instances no-op. */
  tick(elapsedMs: number): void {
    for (const instance of this.instances_) {
      instance.tick(elapsedMs);
    }
    this.frame_++;
    this.notifyFrame();
  }

  /** Starts the render-loop tick driver. Browser only; a no-op if already running. */
  start(): void {
    if (this.rafHandle !== undefined) {
      return;
    }
    const onFrame = (nowMs: number): void => {
      const previous = this.lastFrameMs ?? nowMs;
      this.lastFrameMs = nowMs;
      this.tick(nowMs - previous);
      this.rafHandle = requestAnimationFrame(onFrame);
    };
    this.rafHandle = requestAnimationFrame(onFrame);
  }

  /** Stops the render-loop tick driver. */
  stop(): void {
    if (this.rafHandle === undefined) {
      return;
    }
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = undefined;
    this.lastFrameMs = undefined;
  }

  /** Subscribes to instance-list changes (add/remove) for `useSyncExternalStore`. */
  subscribeToInstances = (listener: () => void): (() => void) => {
    this.instanceListeners.add(listener);
    return () => {
      this.instanceListeners.delete(listener);
    };
  };

  /** Snapshot of the instance list for `useSyncExternalStore`. */
  getInstances = (): readonly SimulatorInstance[] => {
    return this.instances_;
  };

  /** Subscribes to per-frame ticks for re-rendering device snapshots. */
  subscribeToFrame = (listener: () => void): (() => void) => {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  };

  /** Monotonic frame counter; a stable `useSyncExternalStore` snapshot that changes each tick. */
  getFrame = (): number => {
    return this.frame_;
  };

  private applyFlashState(instance: SimulatorInstance, state: FlashState): void {
    instance.flashState = state;
    // New array reference so the instance-list snapshot changes for useSyncExternalStore.
    this.instances_ = [...this.instances_];
    this.notifyInstances();
  }

  private notifyInstances(): void {
    for (const listener of this.instanceListeners) {
      listener();
    }
  }

  private notifyFrame(): void {
    for (const listener of this.frameListeners) {
      listener();
    }
  }
}
