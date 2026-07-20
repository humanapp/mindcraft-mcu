import { fileURLToPath } from "node:url";
import type {
  ExtensionFetchBranchResult,
  ExtensionFetchFileResult,
  ExtensionFetchTransport,
  ExtensionVersionListResult,
} from "@mindcraft-lang/app-host";
import { MINDCRAFT_JSON_PATH, parseExtensionReference } from "@mindcraft-lang/app-host";
import type { FetchedExtensionContentMap } from "@mindcraft-lang/bridge-app";
import { buildEmbeddedExtensionFromDir } from "@mindcraft-lang/bridge-app/node";
import { microbitCatalogEntryRef, microbitLibraryCatalogMoves } from "../services/microbit-extension-browser";
import {
  CODAL_POSITION_EXT_COORDINATE,
  CUTEBOT_EXT_COORDINATE,
  YAHBOOM_GAMEPAD_EXT_COORDINATE,
} from "../services/microbit-extension-coordinates";

/**
 * The pinned `gh:` reference the graduated Position library resolves through,
 * read from the bundled catalog's transport-flip move for its coordinate. The
 * move is the single source of truth; the fixture serves whatever pin it names.
 */
export const CODAL_POSITION_GH_REF: string = requireCodalPositionMoveRef();

/** The pinned `gh:` reference the catalog's Cutebot entry installs; the rename move for the retired coordinate names the same pin. */
export const CUTEBOT_GH_REF: string = microbitCatalogEntryRef(CUTEBOT_EXT_COORDINATE);

/** The pinned `gh:` reference the catalog's Yahboom gamepad entry installs; the rename move for the retired coordinate names the same pin. */
export const YAHBOOM_GAMEPAD_GH_REF: string = microbitCatalogEntryRef(YAHBOOM_GAMEPAD_EXT_COORDINATE);

/** Read the Position library's flip-move `ref` from the bundled catalog, throwing when it is absent. */
function requireCodalPositionMoveRef(): string {
  const entries = microbitLibraryCatalogMoves[CODAL_POSITION_EXT_COORDINATE];
  if (entries === undefined || entries.length !== 1) {
    throw new Error(`the bundled catalog declares no single move entry for "${CODAL_POSITION_EXT_COORDINATE}"`);
  }
  return entries[0].ref;
}

/**
 * A published library's on-disk snapshot, assembled from its fixture directory
 * through the shared manifest-driven loader: exactly the files its
 * `mindcraft.json` `files` list names, plus the manifest itself, keyed by
 * extension-relative path with no leading slash.
 */
function fixtureFiles(dirName: string, coordinate: string): ReadonlyMap<string, string> {
  const dir = fileURLToPath(new URL(`../../test-fixtures/${dirName}`, import.meta.url));
  const built = buildEmbeddedExtensionFromDir(dir, coordinate);
  return new Map(built.files.map((file) => [file.path, file.content]));
}

/** Convert an extension-relative file map to the resolver's leading-slash mount convention. */
function mounted(files: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  return new Map([...files].map(([path, content]) => [`/${path}`, content]));
}

/** The declared manifest version of a fixture's content. */
function fixtureVersion(files: ReadonlyMap<string, string>): string {
  const manifest = files.get(MINDCRAFT_JSON_PATH);
  if (manifest === undefined) {
    throw new Error("the fixture snapshot carries no mindcraft.json");
  }
  return (JSON.parse(manifest) as { version: string }).version;
}

/** The immutable pin component of a pinned `gh:` reference. */
function pinOf(reference: string): string {
  const parsed = parseExtensionReference(reference);
  if (parsed?.transport !== "gh" || parsed.routing.kind !== "pin") {
    throw new Error(`"${reference}" is not a pinned gh: reference`);
  }
  return parsed.routing.pin;
}

const CUTEBOT_FILES = fixtureFiles("lib-elecfreaks-cutebot", CUTEBOT_EXT_COORDINATE);
const YAHBOOM_FILES = fixtureFiles("lib-yahboom-gamepad", YAHBOOM_GAMEPAD_EXT_COORDINATE);
const CODAL_POSITION_FILES = fixtureFiles("lib-codal-position", CODAL_POSITION_EXT_COORDINATE);

/**
 * The version-form pinned `gh:` reference the published chassis manifests
 * declare their Position dependency as, read from the Cutebot snapshot's
 * `mindcraft.json`. Its pin is the bare release version; the GitHub tag it
 * resolves against is v-prefixed, a mapping jsDelivr performs.
 */
export const CODAL_POSITION_VERSION_REF: string = requireCodalPositionVersionRef();

function requireCodalPositionVersionRef(): string {
  const manifest = CUTEBOT_FILES.get(MINDCRAFT_JSON_PATH);
  if (manifest === undefined) {
    throw new Error("the Cutebot fixture snapshot carries no mindcraft.json");
  }
  const declared = (JSON.parse(manifest) as { extensions?: Record<string, string> }).extensions?.[
    CODAL_POSITION_EXT_COORDINATE
  ];
  if (declared === undefined) {
    throw new Error("the Cutebot fixture manifest declares no Position dependency");
  }
  return declared;
}

/**
 * The published libraries' content as a fetched-content map: one entry per
 * `gh:` reference resolution can encounter -- the Cutebot and Yahboom gamepad
 * catalog pins, the Position flip-move pin, and the version-form Position pin
 * the published chassis manifests declare. Paths carry the leading slash the
 * resolver's mount convention uses.
 */
export const publishedLibraryFetched: FetchedExtensionContentMap = new Map([
  [CUTEBOT_GH_REF, mounted(CUTEBOT_FILES)],
  [YAHBOOM_GAMEPAD_GH_REF, mounted(YAHBOOM_FILES)],
  [CODAL_POSITION_GH_REF, mounted(CODAL_POSITION_FILES)],
  [CODAL_POSITION_VERSION_REF, mounted(CODAL_POSITION_FILES)],
]);

/** One repository the fixture transport serves: its pins, files, and published release versions. */
interface RepoFixture {
  readonly coordinate: string;
  readonly pins: ReadonlySet<string>;
  readonly files: ReadonlyMap<string, string>;
  /** Release versions as the transport reports them, with any tag `v` prefix already stripped. */
  readonly versions: readonly string[];
}

function repoFixtures(): readonly RepoFixture[] {
  return [
    {
      coordinate: CUTEBOT_EXT_COORDINATE,
      pins: new Set([pinOf(CUTEBOT_GH_REF)]),
      files: CUTEBOT_FILES,
      versions: [fixtureVersion(CUTEBOT_FILES)],
    },
    {
      coordinate: YAHBOOM_GAMEPAD_EXT_COORDINATE,
      pins: new Set([pinOf(YAHBOOM_GAMEPAD_GH_REF)]),
      files: YAHBOOM_FILES,
      versions: [fixtureVersion(YAHBOOM_FILES)],
    },
    {
      coordinate: CODAL_POSITION_EXT_COORDINATE,
      pins: new Set([pinOf(CODAL_POSITION_GH_REF), pinOf(CODAL_POSITION_VERSION_REF)]),
      files: CODAL_POSITION_FILES,
      versions: [fixtureVersion(CODAL_POSITION_FILES)],
    },
  ];
}

/**
 * A deterministic fetch transport serving the published libraries' snapshots
 * from the on-disk fixtures, for exactly the coordinates and pins the catalog
 * and the published manifests name. Every other repository, pin, branch, or
 * path answers as absent, so installs and load-time heals exercise the `gh:`
 * fetch path without touching the network.
 *
 * @param options.refuse - Coordinates whose every request answers not-found,
 *   simulating an outage of just those repositories.
 */
export function createPublishedLibraryFixtureTransport(options?: {
  refuse?: ReadonlySet<string>;
}): ExtensionFetchTransport {
  const repos = repoFixtures().filter((repo) => !(options?.refuse?.has(repo.coordinate) ?? false));
  const byCoordinate = new Map(repos.map((repo) => [repo.coordinate, repo]));
  const encoder = new TextEncoder();
  return {
    async fetchFile(owner: string, repo: string, pin: string, path: string): Promise<ExtensionFetchFileResult> {
      const fixture = byCoordinate.get(`${owner}/${repo}`);
      const content = fixture?.pins.has(pin) ? fixture.files.get(path) : undefined;
      if (content === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, content: encoder.encode(content) };
    },
    async resolveBranch(): Promise<ExtensionFetchBranchResult> {
      return { ok: false, kind: "not-found" };
    },
    async listVersionTags(owner: string, repo: string): Promise<ExtensionVersionListResult> {
      const fixture = byCoordinate.get(`${owner}/${repo}`);
      if (fixture === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, versions: [...fixture.versions] };
    },
  };
}
