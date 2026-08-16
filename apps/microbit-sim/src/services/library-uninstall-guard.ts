import type { FileContent, ProjectFileSystem } from "@mindcraft-lang/app-host";
import type {
  EmbeddedExtension,
  FetchedExtensionContentMap,
  LibraryUninstallImpact,
  UninstallGuardBrain,
} from "@mindcraft-lang/bridge-app";
import { collectLibraryUninstallImpact } from "@mindcraft-lang/bridge-app";

/** The slice of a cached brain the guard reads. */
export interface GuardedBrain {
  name(): string;
}

/** The host surface the uninstall guard reads: the cached brains and the project's user content files. */
export interface UninstallGuardHost {
  getCachedBrainKeys(): readonly string[];
  getCachedBrain(key: string): GuardedBrain | undefined;
  serializeBrainForStorage(brainDef: GuardedBrain): unknown;
  readonly projectFileSystem: ProjectFileSystem;
}

/**
 * Compute what uninstalling `coordinate` takes away from the active
 * microbit-sim project: the saved brains referencing a leaving library
 * namespace and the user content files importing one through `@lib/`.
 *
 * @param host - The host surface holding the cached brains and project files.
 * @param extensions - The project's current extensions map, keyed by coordinate.
 * @param coordinate - The `<owner>/<repo>` coordinate being uninstalled.
 * @param embedRecord - The bundled embedded extensions to resolve against.
 * @param installedContent - Installed fetched-extension content, keyed by reference.
 */
export function collectMicrobitLibraryUninstallImpact(
  host: UninstallGuardHost,
  extensions: Readonly<Record<string, string>> | undefined,
  coordinate: string,
  embedRecord: readonly EmbeddedExtension[],
  installedContent?: FetchedExtensionContentMap
): LibraryUninstallImpact {
  const brains: UninstallGuardBrain[] = [];
  for (const key of host.getCachedBrainKeys()) {
    const brain = host.getCachedBrain(key);
    if (brain) {
      brains.push({ name: brain.name(), json: host.serializeBrainForStorage(brain) });
    }
  }
  const files = new Map<string, FileContent>();
  for (const [path, entry] of host.projectFileSystem.exportSnapshot()) {
    if (entry.kind === "file") {
      files.set(path, entry.content);
    }
  }
  return collectLibraryUninstallImpact({
    extensions,
    coordinate,
    embedded: embedRecord,
    ...(installedContent !== undefined ? { fetched: installedContent } : {}),
    brains,
    files,
  });
}
