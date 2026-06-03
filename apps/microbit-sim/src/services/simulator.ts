import type { MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { MicroBit, type MicroBitSnapshot, WodalMicroBitRuntime } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { SharedMedium } from "./shared-medium";

/**
 * One simulated microbit instance: its `MicroBit` device, the WODAL runtime bound to that device and
 * the shared Mindcraft environment, and the id of the brain flashed onto it, if any.
 */
export class SimulatorInstance {
  readonly id: string;
  readonly microbit: MicroBit;
  readonly runtime: WodalMicroBitRuntime;

  /** Id of the brain currently flashed onto this instance, or undefined when none is loaded. */
  flashedBrainId: string | undefined;

  constructor(id: string, environment: MindcraftEnvironment) {
    this.id = id;
    this.microbit = new MicroBit();
    this.runtime = new WodalMicroBitRuntime({ environment, microbit: this.microbit });
    this.flashedBrainId = undefined;
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
