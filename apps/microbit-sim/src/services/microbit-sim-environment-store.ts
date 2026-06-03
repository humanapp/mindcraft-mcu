import {
  createIdbProjectStore,
  createWebLocksProjectLock,
  DEFAULT_PROJECT_NAME,
  type ProjectFileSystem,
  ProjectManager,
  type ProjectManifest,
} from "@mindcraft-lang/app-host";
import { AppEnvironmentHost } from "@mindcraft-lang/bridge-app";
import {
  BrainDef,
  coreModule,
  createMindcraftEnvironment,
  MathOps,
  type MindcraftEnvironment,
} from "@mindcraft-lang/core/app";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";
import { getWodalDeviceProfile, type WodalBuildInput, WodalDeviceProfileId } from "@mindcraft-lang/wodal";
import { createMicroBitV2Module } from "@mindcraft-lang/wodal/targets/microbit-v2";
import { name as appName, version as appVersion } from "../../package.json";
import { microbitAmbientFiles } from "./microbit-ambient-files";
import { MicrobitSimulator } from "./simulator";

/** Project app-data key holding the ordered brain index (id and name). */
const BRAINS_INDEX_KEY = "brains-index";

/** A brain's portable identity: a stable UUID and an editable display name. */
export interface BrainRecord {
  readonly id: string;
  readonly name: string;
}

function parseBrainIndex(raw: string | undefined): BrainRecord[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const records: BrainRecord[] = [];
    for (const entry of parsed) {
      const record = entry as { id?: unknown; name?: unknown };
      if (record && typeof record.id === "string" && typeof record.name === "string") {
        records.push({ id: record.id, name: record.name });
      }
    }
    return records;
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

  private _brains: readonly BrainRecord[] = [];
  private _selectedBrainId: string | undefined;
  private readonly _brainsListeners = new Set<() => void>();
  private readonly _activeProjectListeners = new Set<() => void>();

  private constructor(host: AppEnvironmentHost) {
    this.host = host;
    this.simulator = new MicrobitSimulator(host.env);
    this.host.onProjectLoaded(() => {
      void this.reloadBrains();
    });
  }

  /** Creates the store with the core and microbit-v2 modules installed. */
  static async create(): Promise<MicrobitSimEnvironmentStore> {
    const projectStore = await createIdbProjectStore(appName);
    const host = new AppEnvironmentHost({
      projectManager: new ProjectManager(projectStore, {
        filesystemOptions: {
          shouldExclude: (path) => isCompilerControlledPath(path, { ambientFiles: microbitAmbientFiles }),
        },
        lock: createWebLocksProjectLock(appName),
      }),
      modules: [coreModule(), createMicroBitV2Module()],
      ambientFiles: microbitAmbientFiles,
      host: { name: appName, version: appVersion },
      userTileStorageKey: `${appName}:user-tile-metadata`,
      rng: { next: () => MathOps.random() },
    });
    return new MicrobitSimEnvironmentStore(host);
  }

  /** Opens or creates the durable default project. */
  async initialize(): Promise<void> {
    await this.host.initialize(DEFAULT_PROJECT_NAME);
    await this.reloadBrains();
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
    const id = crypto.randomUUID();
    const brainDef = this.env.withServices((services) => BrainDef.emptyBrainDef(services, name));
    await this.host.saveBrainForKey(id, brainDef);
    this._brains = [...this._brains, { id, name }];
    await this.persistBrainIndex();
    this._selectedBrainId = id;
    this.notifyBrainsChanged();
    return id;
  }

  /** Removes a brain and its stored definition, unflashing any instance running it. */
  async removeBrain(id: string): Promise<void> {
    await this.host.removeBrain(id);
    this._brains = this._brains.filter((brain) => brain.id !== id);
    await this.persistBrainIndex();
    if (this._selectedBrainId === id) {
      this._selectedBrainId = this._brains[0]?.id;
    }
    this.notifyBrainsChanged();
    this.simulator.unflash(id);
  }

  /** Renames a brain across the index and the brain definition, preserving the UUID. */
  async renameBrain(id: string, name: string): Promise<void> {
    const brainDef = await this.getBrain(id);
    if (brainDef) {
      brainDef.setName(name);
      await this.host.saveBrainForKey(id, brainDef);
    }
    this._brains = this._brains.map((brain) => (brain.id === id ? { id, name } : brain));
    await this.persistBrainIndex();
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

  /** Persists an edited brain definition, syncs the index name, and re-flashes instances running it. */
  async saveBrain(id: string, brainDef: BrainDef): Promise<void> {
    await this.host.saveBrainForKey(id, brainDef);
    const name = brainDef.name();
    const record = this._brains.find((brain) => brain.id === id);
    if (record && record.name !== name) {
      this._brains = this._brains.map((brain) => (brain.id === id ? { id, name } : brain));
      await this.persistBrainIndex();
      this.notifyBrainsChanged();
    }
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
    const brainDef = await this.getBrain(brainId);
    if (!brainDef) {
      return undefined;
    }
    return {
      brainDef,
      environment: this.env,
      deviceProfile: getWodalDeviceProfile(WodalDeviceProfileId.MICROBIT_V2),
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

  private async reloadBrains(): Promise<void> {
    const raw = await this.host.projectManager.loadAppData(BRAINS_INDEX_KEY);
    this._brains = parseBrainIndex(raw);
    this._selectedBrainId = this._brains.some((brain) => brain.id === this._selectedBrainId)
      ? this._selectedBrainId
      : this._brains[0]?.id;
    this.notifyBrainsChanged();
  }

  private async persistBrainIndex(): Promise<void> {
    await this.host.projectManager.saveAppData(BRAINS_INDEX_KEY, JSON.stringify(this._brains));
  }

  private notifyBrainsChanged(): void {
    for (const listener of this._brainsListeners) {
      listener();
    }
  }
}
