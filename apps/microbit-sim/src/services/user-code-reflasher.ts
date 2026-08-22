import { type IBrainDef, mkActuatorTileId, mkSensorTileId } from "@wendoo-lang/core/app";

/** Default quiet period before a coalesced reflash runs, in milliseconds. */
export const DEFAULT_USER_CODE_REFLASH_DEBOUNCE_MS = 250;

/** Collaborators the {@link UserCodeReflasher} reads and drives. */
export interface UserCodeReflasherDeps {
  /** Ids of the brains associated with a simulator instance, whether their last flash loaded or failed. */
  flashedBrainIds(): readonly string[];
  /** The cached definition for `brainId`, or undefined when it is not loaded. */
  getBrainDef(brainId: string): IBrainDef | undefined;
  /** Rebuilds `brainId` from its latest definition and reflashes every instance associated with it. */
  reflashBrain(brainId: string): void;
}

/** True when `brainDef` references the user action `actionKey` as either a sensor or an actuator tile. */
function brainUsesAction(brainDef: IBrainDef, actionKey: string): boolean {
  return brainDef.containsTileId(mkSensorTileId(actionKey)) || brainDef.containsTileId(mkActuatorTileId(actionKey));
}

/**
 * Reflashes simulator instances when the user-code actions their brains use are
 * recompiled. Changed action keys reported by successive compiles are
 * accumulated and the reflash is coalesced behind a short quiet period; a burst
 * of rapid edits triggers a single reflash per affected instance.
 */
export class UserCodeReflasher {
  private readonly deps: UserCodeReflasherDeps;
  private readonly debounceMs: number;
  private readonly pendingActionKeys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: UserCodeReflasherDeps, debounceMs: number = DEFAULT_USER_CODE_REFLASH_DEBOUNCE_MS) {
    this.deps = deps;
    this.debounceMs = debounceMs;
  }

  /**
   * Records the user actions a compile changed and schedules a coalesced reflash
   * of every flashed brain that uses one of them. An empty key list is ignored.
   */
  onActionsChanged(changedActionKeys: readonly string[]): void {
    if (changedActionKeys.length === 0) {
      return;
    }
    for (const key of changedActionKeys) {
      this.pendingActionKeys.add(key);
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.flush();
    }, this.debounceMs);
  }

  /** Applies every accumulated change now, reflashing affected brains and cancelling any pending timer. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pendingActionKeys.size === 0) {
      return;
    }
    const changedKeys = [...this.pendingActionKeys];
    this.pendingActionKeys.clear();

    const reflashed = new Set<string>();
    for (const brainId of this.deps.flashedBrainIds()) {
      if (reflashed.has(brainId)) {
        continue;
      }
      const brainDef = this.deps.getBrainDef(brainId);
      if (!brainDef) {
        continue;
      }
      if (changedKeys.some((key) => brainUsesAction(brainDef, key))) {
        reflashed.add(brainId);
        this.deps.reflashBrain(brainId);
      }
    }
  }

  /** Cancels any pending reflash and drops accumulated changes without reflashing. */
  cancelPending(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pendingActionKeys.clear();
  }
}
