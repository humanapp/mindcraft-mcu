import {
  createIdbProjectStore,
  createWebLocksProjectLock,
  DEFAULT_PROJECT_NAME,
  type ImportProjectTargetsResult,
  type ImportResult,
  importProjectDocument,
  type ProjectFileSystem,
  ProjectManager,
  type ProjectManifest,
} from "@mindcraft-lang/app-host";
import { AppEnvironmentHost } from "@mindcraft-lang/bridge-app";
import { BrainDef, coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import {
  getWodalDeviceProfile,
  validateWodalTarget,
  type WodalBuildInput,
  type WodalDeviceProfile,
  WodalDeviceProfileId,
} from "@mindcraft-lang/wodal";
import { name as appName, version as appVersion } from "../../package.json";
import { microbitAmbientFiles } from "./microbit-ambient-files";
import {
  BRAINS_INDEX_KEY,
  buildMicrobitSimExportDocument,
  type MicrobitSimFleet,
  parseMicrobitSimTarget,
  SIMULATOR_STATE_KEY,
} from "./project-io";
import { MicrobitSimulator } from "./simulator";

/** Parses the persisted simulator fleet; returns undefined when absent or malformed. */
function parseSimulatorState(raw: string | undefined): MicrobitSimFleet | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { order?: unknown; flash?: unknown };
    if (!Array.isArray(parsed.order)) {
      return undefined;
    }
    const order = parsed.order.filter((id): id is string => typeof id === "string");
    const flash: Record<string, string> = {};
    if (parsed.flash && typeof parsed.flash === "object") {
      for (const [id, brainId] of Object.entries(parsed.flash as Record<string, unknown>)) {
        if (typeof brainId === "string") {
          flash[id] = brainId;
        }
      }
    }
    return { order, flash };
  } catch {
    return undefined;
  }
}

/** A brain's id and current display name, read from its definition, for the brain-list UI. */
export interface BrainRecord {
  readonly id: string;
  readonly name: string;
}

/** Parses the persisted brain index: an ordered JSON array of brain ids. Non-string entries are ignored. */
function parseBrainIndex(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * Owns the long-lived microbit-sim app state: the caller-owned Mindcraft
 * environment, the durable project lifecycle, and the user-managed brain list.
 *
 * Brains are a flat, dynamic list keyed by UUID with editable display names.
 * There is no archetype concept. React components consume the store through the
 * environment context. The store wraps {@link AppEnvironmentHost} and is
 * constructed through {@link create}.
 */
export class MicrobitSimEnvironmentStore {
  readonly host: AppEnvironmentHost;

  /** The simulated microbit fleet (instances, shared medium, tick driver). */
  readonly simulator: MicrobitSimulator;

  /** The device profile this app instance runs: drives the environment module, builds, import, and export. */
  readonly activeDeviceProfile: WodalDeviceProfile;

  private _brainIds: readonly string[] = [];
  private _brains: readonly BrainRecord[] = [];
  private _selectedBrainId: string | undefined;
  private _restoringFleet = false;
  private readonly _brainsListeners = new Set<() => void>();
  private readonly _activeProjectListeners = new Set<() => void>();

  private constructor(host: AppEnvironmentHost, activeDeviceProfile: WodalDeviceProfile) {
    this.host = host;
    this.activeDeviceProfile = activeDeviceProfile;
    this.simulator = new MicrobitSimulator(host.env);
    // The instance-list listener fires on fleet changes (add/remove/flash), not on per-tick device updates.
    this.simulator.subscribeToInstances(() => {
      void this.persistSimulatorState();
    });
    this.host.onProjectLoaded(() => {
      void this.reloadProjectState();
    });
  }

  /** Creates the store with the core module and the active device profile's module installed. */
  static async create(): Promise<MicrobitSimEnvironmentStore> {
    // The one place this app declares its device; the module and the build profile both derive from it.
    const activeProfile = getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2);
    const projectStore = await createIdbProjectStore(appName);
    const host = new AppEnvironmentHost({
      projectManager: new ProjectManager(projectStore, {
        filesystemOptions: {
          shouldExclude: (path) => isCompilerControlledPath(path, { ambientFiles: microbitAmbientFiles }),
        },
        lock: createWebLocksProjectLock(appName),
      }),
      modules: [coreModule(), activeProfile.createMindcraftModule()],
      ambientFiles: microbitAmbientFiles,
      host: { name: appName, version: appVersion },
      userTileStorageKey: `${appName}:user-tile-metadata`,
      // Minted ids (brain id, page id) must be unique across sessions; the deterministic MathOps.random
      // LCG repeats every load and would collide.
      rng: { next: () => Math.random() },
    });
    return new MicrobitSimEnvironmentStore(host, activeProfile);
  }

  /** Opens or creates the durable default project. */
  async initialize(): Promise<void> {
    await this.host.initialize(DEFAULT_PROJECT_NAME);
    await this.reloadProjectState();
  }

  /** Caller-owned Mindcraft environment shared across the app. */
  get env(): MindcraftEnvironment {
    return this.host.env;
  }

  /** Durable project lifecycle manager. */
  get projectManager(): ProjectManager {
    return this.host.projectManager;
  }

  /** Active project file system. */
  get projectFileSystem(): ProjectFileSystem {
    return this.host.projectFileSystem;
  }

  /** Manifest of the active project, or undefined when none is open. */
  get activeProjectManifest(): ProjectManifest | undefined {
    return this.host.activeProjectManifest;
  }

  /** Registers a listener fired after a project finishes loading. */
  onProjectLoaded(listener: () => void): () => void {
    return this.host.onProjectLoaded(listener);
  }

  /** Registers a listener fired before the active project unloads. */
  onProjectUnloading(listener: () => void): () => void {
    return this.host.onProjectUnloading(listener);
  }

  /** Creates a durable project and makes it active. */
  async createProject(name: string): Promise<void> {
    await this.host.createProject(name);
  }

  /** Switches the active project within the current collection. */
  async switchProject(id: string): Promise<void> {
    await this.host.switchProject(id);
  }

  /** Renames the active project. */
  async renameProject(name: string): Promise<void> {
    await this.host.updateProjectMetadata({ name });
    for (const listener of this._activeProjectListeners) {
      listener();
    }
  }

  /** Lists durable projects in the active collection. */
  async listProjects(): Promise<ProjectManifest[]> {
    return this.host.projectManager.listProjects();
  }

  /** Imports a `.mindcraft` file as a new durable project and switches to it on success. */
  async importProject(file: File): Promise<ImportResult> {
    const result = await importProjectDocument(file, appName, appVersion, this.host.projectManager, {
      targetsCallback: (targets, appTarget) => this.translateTargets(targets, appTarget),
    });
    if (result.success && result.projectId) {
      await this.switchProject(result.projectId);
    }
    return result;
  }

  /** Validates the WODAL target and translates microbit-sim's payload into seeded app-data. */
  private translateTargets(targets: Readonly<Record<string, unknown>>, appTarget: unknown): ImportProjectTargetsResult {
    const wodal = validateWodalTarget(targets);
    if (!wodal.ok) {
      return { diagnostics: wodal.errors.map((error) => ({ severity: "error" as const, message: error.message })) };
    }
    if (wodal.target.profile !== this.activeDeviceProfile.profileId) {
      return {
        diagnostics: [
          {
            severity: "error",
            message: `This project targets "${wodal.target.profile}"; this simulator runs "${this.activeDeviceProfile.profileId}".`,
          },
        ],
      };
    }

    const app = parseMicrobitSimTarget(appTarget);
    const appData: Record<string, string> = {};
    if (app.brainOrder.length > 0) {
      appData[BRAINS_INDEX_KEY] = JSON.stringify(app.brainOrder);
    }
    if (app.simulator) {
      appData[SIMULATOR_STATE_KEY] = JSON.stringify(app.simulator);
    }
    return { diagnostics: [], appData };
  }

  /** Exports the active project as a shared `.mindcraft` document string. */
  async exportProject(): Promise<string> {
    return buildMicrobitSimExportDocument(this.host.projectManager, this.activeDeviceProfile.profileId, {
      brainOrder: [...this._brainIds],
      simulator: this.simulatorStateSnapshot(),
    });
  }

  /** Subscribes to active-project changes for `useSyncExternalStore`. */
  subscribeToActiveProject = (listener: () => void): (() => void) => {
    this._activeProjectListeners.add(listener);
    const unsubscribe = this.host.projectManager.onActiveProjectChange(listener);
    return () => {
      this._activeProjectListeners.delete(listener);
      unsubscribe();
    };
  };

  /** Snapshot of the active project name for `useSyncExternalStore`. */
  getActiveProjectName = (): string => {
    return this.host.activeProjectManifest?.name ?? "(no project)";
  };

  /** Creates a brain seeded from an empty definition and selects it. */
  async addBrain(name: string): Promise<string> {
    const brainDef = this.env.withServices((services) => BrainDef.emptyBrainDef(services, name));
    // Invariant: microbit-sim keys host brain storage by the brain's own id.
    const id = brainDef.id();
    await this.host.saveBrainForKey(id, brainDef);
    this._brainIds = [...this._brainIds, id];
    await this.persistBrainIndex();
    this._selectedBrainId = id;
    this.rebuildBrains();
    this.notifyBrainsChanged();
    return id;
  }

  /** Removes a brain and its stored definition, unflashing any instance running it. */
  async removeBrain(id: string): Promise<void> {
    await this.host.removeBrain(id);
    this._brainIds = this._brainIds.filter((brainId) => brainId !== id);
    await this.persistBrainIndex();
    if (this._selectedBrainId === id) {
      this._selectedBrainId = this._brainIds[0];
    }
    this.rebuildBrains();
    this.notifyBrainsChanged();
    this.simulator.unflash(id);
  }

  /** Renames a brain by updating its definition. */
  async renameBrain(id: string, name: string): Promise<void> {
    const brainDef = this.host.getCachedBrain(id) ?? (await this.getBrain(id));
    if (!brainDef) {
      return;
    }
    brainDef.setName(name);
    await this.host.saveBrainForKey(id, brainDef);
    this.rebuildBrains();
    this.notifyBrainsChanged();
  }

  /** Sets the selected brain. */
  selectBrain(id: string): void {
    this._selectedBrainId = id;
    this.notifyBrainsChanged();
  }

  /** Loads a brain definition by id. */
  async getBrain(id: string): Promise<BrainDef | undefined> {
    return (await this.host.loadBrainFromProject(id)) as BrainDef | undefined;
  }

  /** Persists an edited brain definition (replacing the cached instance) and re-flashes instances running it. */
  async saveBrain(id: string, brainDef: BrainDef): Promise<void> {
    await this.host.saveBrainForKey(id, brainDef);
    this.rebuildBrains();
    this.notifyBrainsChanged();
    await this.reflashBrain(id);
  }

  /**
   * Returns the live build input for the selected brain, or undefined when no
   * brain is selected. Returns the canonical WODAL build-input shape with live
   * objects, not a serialized `.mindcraft` document, so the WODAL build kernel
   * can consume it directly. The selected brain id is available separately via
   * {@link getSelectedBrainId}.
   */
  async getBuildInput(): Promise<WodalBuildInput | undefined> {
    const brainId = this._selectedBrainId;
    if (!brainId) {
      return undefined;
    }
    return this.buildInputForBrain(brainId);
  }

  /** Assembles the WODAL build input for a specific brain, or undefined when it cannot be loaded. */
  private async buildInputForBrain(brainId: string): Promise<WodalBuildInput | undefined> {
    const brainDef = this.host.getCachedBrain(brainId);
    if (!brainDef) {
      return undefined;
    }
    return {
      brainDef,
      environment: this.env,
      deviceProfile: this.activeDeviceProfile,
    };
  }

  /** Flashes the editor-selected brain onto the given simulator instance. */
  async flashInstance(instanceId: string): Promise<void> {
    const brainId = this.getSelectedBrainId();
    const input = await this.getBuildInput();
    this.simulator.flash(instanceId, input, brainId);
  }

  /** Re-flashes every instance currently running `brainId` from the brain's latest definition. */
  async reflashBrain(brainId: string): Promise<void> {
    const hasTargets = this.simulator
      .getInstances()
      .some((instance) => instance.flashState.status === "loaded" && instance.flashState.brainId === brainId);
    if (!hasTargets) {
      return;
    }
    const input = await this.buildInputForBrain(brainId);
    if (!input) {
      return;
    }
    this.simulator.reflash(brainId, input);
  }

  /** Subscribes to brain-list or selection changes for `useSyncExternalStore`. */
  subscribeToBrains = (listener: () => void): (() => void) => {
    this._brainsListeners.add(listener);
    return () => {
      this._brainsListeners.delete(listener);
    };
  };

  /** Snapshot of the brain list for `useSyncExternalStore`. */
  getBrains = (): readonly BrainRecord[] => {
    return this._brains;
  };

  /** Snapshot of the selected brain id for `useSyncExternalStore`. */
  getSelectedBrainId = (): string | undefined => {
    return this._selectedBrainId;
  };

  /** Releases host resources owned by this store. */
  dispose(): void {
    this.host.dispose();
  }

  /** Restores brain list and simulator fleet from the active project. Runs after the host loads its brain cache. */
  private async reloadProjectState(): Promise<void> {
    await this.reloadBrains();
    await this.reloadSimulatorState();
  }

  private async reloadBrains(): Promise<void> {
    const raw = await this.host.projectManager.loadAppData(BRAINS_INDEX_KEY);
    const indexed = parseBrainIndex(raw);
    // Reconcile against the host cache (the source of truth for which brains exist): keep the index
    // order for brains that exist, drop dangling ids, and append cached brains the index omits (e.g. an
    // imported or payload-less document), so no brain is unreachable.
    const cached = this.host.getCachedBrainKeys();
    const cachedSet = new Set(cached);
    const ordered = indexed.filter((id) => cachedSet.has(id));
    const orderedSet = new Set(ordered);
    this._brainIds = [...ordered, ...cached.filter((id) => !orderedSet.has(id))];
    const changed = this._brainIds.length !== indexed.length || this._brainIds.some((id, i) => id !== indexed[i]);
    if (changed) {
      await this.persistBrainIndex();
    }
    const selected = this._selectedBrainId;
    this._selectedBrainId = selected && this._brainIds.includes(selected) ? selected : this._brainIds[0];
    this.rebuildBrains();
    this.notifyBrainsChanged();
  }

  /** Rebuilds the derived brain-list snapshot from the host's brain cache. Names are read live from the defs. */
  private rebuildBrains(): void {
    this._brains = this._brainIds.map((id) => ({ id, name: this.host.getCachedBrain(id)?.name() ?? "" }));
  }

  private async persistBrainIndex(): Promise<void> {
    await this.host.projectManager.saveAppData(BRAINS_INDEX_KEY, JSON.stringify(this._brainIds));
  }

  /**
   * Restores the simulator fleet from durable state: recreates the saved instances in order and
   * re-flashes each from its brain. An instance whose brain no longer exists is left empty. Absent or
   * malformed state restores a single empty instance.
   */
  private async reloadSimulatorState(): Promise<void> {
    const raw = await this.host.projectManager.loadAppData(SIMULATOR_STATE_KEY);
    const state = parseSimulatorState(raw);
    this._restoringFleet = true;
    try {
      if (!state || state.order.length === 0) {
        // No saved fleet: one fresh empty instance (the simulator mints its id).
        this.simulator.setInstances([]);
        this.simulator.addInstance();
      } else {
        const instances = this.simulator.setInstances(state.order);
        for (const instance of instances) {
          const brainId = state.flash[instance.id];
          if (!brainId) {
            continue;
          }
          const input = await this.buildInputForBrain(brainId);
          if (input) {
            this.simulator.flash(instance.id, input, brainId);
          }
        }
      }
    } finally {
      this._restoringFleet = false;
    }
    if (!state || state.order.length === 0) {
      // Persist the freshly minted default fleet so its id is reused on the next load.
      await this.persistSimulatorState();
    }
  }

  /** The current fleet as a persistable snapshot: ordered instance ids and the brain each is flashed with. */
  private simulatorStateSnapshot(): MicrobitSimFleet {
    const instances = this.simulator.getInstances();
    const order = instances.map((instance) => instance.id);
    const flash: Record<string, string> = {};
    for (const instance of instances) {
      const brainId = instance.flashedBrainId;
      if (brainId) {
        flash[instance.id] = brainId;
      }
    }
    return { order, flash };
  }

  /** Persists the current fleet as durable project state. */
  private async persistSimulatorState(): Promise<void> {
    if (this._restoringFleet) {
      return;
    }
    await this.host.projectManager.saveAppData(SIMULATOR_STATE_KEY, JSON.stringify(this.simulatorStateSnapshot()));
  }

  private notifyBrainsChanged(): void {
    for (const listener of this._brainsListeners) {
      listener();
    }
  }
}
