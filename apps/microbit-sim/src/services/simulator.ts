import type { WendooEnvironment } from "@wendoo-lang/core/app";
import type { ErrorValue } from "@wendoo-lang/core/runtime";
import { buildWodalProgramImage, type WodalBuildInput } from "@wendoo-lang/wodal";
import {
  GestureInjector,
  MicroBit,
  type MicroBitSnapshot,
  type RadioSendRecord,
  WodalMicroBitRuntime,
} from "@wendoo-lang/wodal/targets/microbit-v2";
import { SharedMedium } from "./shared-medium";

/** One radio send buffered during a frame: its sender and the transmitted packet. */
interface BufferedSend {
  readonly fromId: string;
  readonly record: RadioSendRecord;
}

/** A classified flash diagnostic, carrying a stable WODAL code verbatim. */
export interface FlashDiagnostic {
  readonly code: string;
  readonly message: string;
}

/**
 * A VM fiber fault raised while a loaded brain was running, tagged with the
 * instance and the brain it was flashed from so it can be routed to that
 * brain's diagnostics. The `err` carries the VM's own error code and message.
 */
export interface InstanceFiberFault {
  /** Id of the instance whose runtime raised the fault. */
  readonly instanceId: string;

  /** Brain the faulting instance was flashed from, or undefined when none is associated. */
  readonly brainId: string | undefined;

  /** Id of the fiber that faulted. */
  readonly fiberId: number;

  /** The VM error value, carrying the fault code and message verbatim. */
  readonly err: ErrorValue;
}

/**
 * Per-instance flash outcome: `empty` before any flash, `loaded` with the flashed brain id, or
 * `failed` with classified diagnostics. A failed flash keeps the brain id: the instance stays
 * associated with the brain the user selected, and a later successful rebuild re-flashes it.
 */
export type FlashState =
  | { readonly status: "empty" }
  | { readonly status: "loaded"; readonly brainId: string }
  | { readonly status: "failed"; readonly brainId: string; readonly errors: readonly FlashDiagnostic[] };

/**
 * One simulated microbit instance: its `MicroBit` device, the WODAL runtime bound to that device and
 * the shared Wendoo environment, and its current flash state.
 */
export class SimulatorInstance {
  readonly id: string;
  readonly microbit: MicroBit;
  readonly runtime: WodalMicroBitRuntime;

  /** Drives this device's accelerometer from a selected gesture; advanced by {@link SimulatorInstance.tick}. */
  readonly gestureInjector: GestureInjector;

  /** Current flash state; `empty` until a program is flashed. */
  flashState: FlashState = { status: "empty" };

  constructor(id: string, environment: WendooEnvironment, onFiberFault?: (fault: InstanceFiberFault) => void) {
    this.id = id;
    this.microbit = new MicroBit();
    this.runtime = new WodalMicroBitRuntime({
      environment,
      microbit: this.microbit,
      ...(onFiberFault
        ? {
            vmEvents: {
              onFiberFault: ({ fiberId, err }) =>
                onFiberFault({ instanceId: this.id, brainId: this.flashedBrainId, fiberId, err }),
            },
          }
        : {}),
    });
    this.gestureInjector = new GestureInjector(this.microbit.accelerometer);
  }

  /**
   * Id of the brain associated with this instance -- running when the flash loaded, retained when
   * it failed -- or undefined when no brain has been flashed.
   */
  get flashedBrainId(): string | undefined {
    return this.flashState.status === "empty" ? undefined : this.flashState.brainId;
  }

  /** Advances this instance by elapsed simulated time. Feeds any selected gesture, then runs the loaded brain. */
  tick(elapsedMs: number): void {
    this.gestureInjector.advance(elapsedMs);
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
 * Wendoo environment. Exposes the store subscribe/snapshot pattern for React consumers - the
 * instance list and a per-frame counter.
 */
export class MicrobitSimulator {
  private readonly environment: WendooEnvironment;
  private readonly medium = new SharedMedium();
  private readonly outbox: BufferedSend[] = [];
  private instances_: readonly SimulatorInstance[] = [];
  private readonly instanceListeners = new Set<() => void>();
  private readonly frameListeners = new Set<() => void>();
  private readonly fiberFaultListeners = new Set<(fault: InstanceFiberFault) => void>();
  private frame_ = 0;
  private rafHandle: number | undefined;
  private lastFrameMs: number | undefined;

  constructor(environment: WendooEnvironment) {
    this.environment = environment;
    this.addInstance();
  }

  /** The shared simulated medium instances register into. */
  sharedMedium(): SharedMedium {
    return this.medium;
  }

  /** Creates an instance, registers it into the medium, and returns it. */
  addInstance(): SimulatorInstance {
    const instance = this.createInstance(crypto.randomUUID());
    this.registerInstance(instance);
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
   * Rebuilds the fleet to exactly the given instance ids, in order, as fresh unloaded instances, and
   * returns them. Existing instances are unregistered from the medium and the new ones registered.
   */
  setInstances(ids: readonly string[]): readonly SimulatorInstance[] {
    for (const instance of this.instances_) {
      this.medium.unregister(instance.id);
    }
    const next = ids.map((id) => {
      const instance = this.createInstance(id);
      this.registerInstance(instance);
      return instance;
    });
    this.instances_ = next;
    this.notifyInstances();
    return this.instances_;
  }

  /** Builds and loads `input` onto the target instance, recording the resulting flash state. */
  flash(instanceId: string, input: WodalBuildInput, brainId: string): void {
    const instance = this.instances_.find((candidate) => candidate.id === instanceId);
    if (!instance) {
      return;
    }
    const built = buildWodalProgramImage(input);
    if (!built.ok) {
      // A failed build must not leave the previous program running: unload the
      // runtime so the device visibly goes dark.
      instance.runtime.unload();
      this.applyFlashState(instance, {
        status: "failed",
        brainId,
        errors: built.errors.map((error) => ({ code: error.code, message: error.message })),
      });
      return;
    }
    const loaded = instance.runtime.loadWodalProgramImage(built.image);
    if (loaded.ok) {
      this.applyFlashState(instance, { status: "loaded", brainId });
      return;
    }
    instance.runtime.unload();
    this.applyFlashState(instance, {
      status: "failed",
      brainId,
      errors: loaded.errors.map((error) => ({ code: error.code, message: error.message })),
    });
  }

  /**
   * Re-flashes every instance associated with `brainId` -- loaded or failed -- using a freshly
   * built `input`. A successful rebuild returns a previously failed instance to the loaded state.
   */
  reflash(brainId: string, input: WodalBuildInput): void {
    for (const instance of this.instances_) {
      if (instance.flashedBrainId === brainId) {
        this.flash(instance.id, input, brainId);
      }
    }
  }

  /**
   * The distinct build/link/load failures currently held by instances associated with `brainId`,
   * verbatim. Deduplicated by code and message so several failed instances of the same brain
   * contribute each distinct failure once. Empty when no associated instance is in a failed state.
   */
  flashDiagnosticsForBrain(brainId: string): readonly FlashDiagnostic[] {
    const seen = new Set<string>();
    const out: FlashDiagnostic[] = [];
    for (const instance of this.instances_) {
      if (instance.flashState.status !== "failed" || instance.flashState.brainId !== brainId) {
        continue;
      }
      for (const error of instance.flashState.errors) {
        const key = `${error.code}::${error.message}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push(error);
      }
    }
    return out;
  }

  /** Unflashes every instance associated with `brainId`, returning them to the empty state. */
  unflash(brainId: string): void {
    for (const instance of this.instances_) {
      if (instance.flashedBrainId === brainId) {
        instance.runtime.unload();
        this.applyFlashState(instance, { status: "empty" });
      }
    }
  }

  /**
   * Advances every instance by elapsed simulated time, then delivers the radio
   * packets they sent this frame into the other same-group instances' rings.
   * Unloaded instances no-op. Delivery happens at the frame boundary, so a
   * recipient reads a packet on its next think, and same-frame sends are
   * delivered in a fixed sender-id order independent of instance tick order.
   */
  tick(elapsedMs: number): void {
    for (const instance of this.instances_) {
      instance.tick(elapsedMs);
    }
    this.deliverOutbox();
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

  /** Subscribes to VM fiber faults raised by any instance's runtime. Returns an unsubscribe function. */
  subscribeToFiberFaults(listener: (fault: InstanceFiberFault) => void): () => void {
    this.fiberFaultListeners.add(listener);
    return () => {
      this.fiberFaultListeners.delete(listener);
    };
  }

  /** Creates an instance wired to route its runtime's fiber faults to this simulator's fault listeners. */
  private createInstance(id: string): SimulatorInstance {
    return new SimulatorInstance(id, this.environment, (fault) => this.emitFiberFault(fault));
  }

  private emitFiberFault(fault: InstanceFiberFault): void {
    for (const listener of this.fiberFaultListeners) {
      listener(fault);
    }
  }

  /**
   * Registers an instance's radio endpoint into the medium and routes its sends
   * into the per-frame outbox.
   */
  private registerInstance(instance: SimulatorInstance): void {
    this.medium.register(instance.id, instance.microbit.radio);
    instance.microbit.radio.setSendListener((record) => {
      this.outbox.push({ fromId: instance.id, record });
    });
  }

  /**
   * Delivers this frame's buffered sends, in a fixed order independent of the
   * order instances were ticked: a stable sort by sender id, preserving each
   * sender's own send order. The per-recipient ring depth and overflow apply.
   */
  private deliverOutbox(): void {
    if (this.outbox.length === 0) {
      return;
    }
    this.outbox.sort((a, b) => (a.fromId < b.fromId ? -1 : a.fromId > b.fromId ? 1 : 0));
    for (const { fromId, record } of this.outbox) {
      this.medium.transmit(fromId, record.group, record);
    }
    this.outbox.length = 0;
  }

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
