import { readFileSync } from "node:fs";
import type {
  ExtensionFetchBranchResult,
  ExtensionFetchFileResult,
  ExtensionFetchTransport,
  ExtensionVersionListResult,
} from "@mindcraft-lang/app-host";
import { parseExtensionReference } from "@mindcraft-lang/app-host";
import type { FetchedExtensionContentMap } from "@mindcraft-lang/bridge-app";
import { microbitLibraryCatalogMoves } from "../services/microbit-extension-browser";
import { CODAL_POSITION_EXT_COORDINATE } from "../services/microbit-extension-coordinates";

/**
 * The pinned `gh:` reference the graduated Position library resolves through,
 * read from the bundled catalog's transport-flip move for its coordinate. The
 * move is the single source of truth; the fixture serves whatever pin it names.
 */
export const CODAL_POSITION_GH_REF: string = requireCodalPositionMoveRef();

/** Read the Position library's flip-move `ref` from the bundled catalog, throwing when it is absent. */
function requireCodalPositionMoveRef(): string {
  const entries = microbitLibraryCatalogMoves[CODAL_POSITION_EXT_COORDINATE];
  if (entries === undefined || entries.length !== 1) {
    throw new Error(`the bundled catalog declares no single move entry for "${CODAL_POSITION_EXT_COORDINATE}"`);
  }
  return entries[0].ref;
}

/** Read a published-fixture file's UTF-8 text from the on-disk remote-content snapshot. */
function fixtureText(path: string): string {
  return readFileSync(new URL(`../../test-fixtures/lib-codal-position/${path}`, import.meta.url), "utf8");
}

/** The published snapshot's two files, keyed by extension-relative path. */
const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "mindcraft.json": fixtureText("mindcraft.json"),
  "index.ts": fixtureText("index.ts"),
};

/**
 * The graduated Position library's published content as a fetched-content map
 * keyed by its `gh:` reference: the resolver-facing snapshot the transitive
 * move redirect and a direct `gh:` install both resolve against, mirroring the
 * v0.1.4 publish (its `mindcraft.json` and `index.ts`). Paths carry the
 * leading slash the resolver's mount convention uses.
 */
export const codalPositionPublishedFetched: FetchedExtensionContentMap = new Map([
  [CODAL_POSITION_GH_REF, new Map(Object.entries(FIXTURE_FILES).map(([path, content]) => [`/${path}`, content]))],
]);

/**
 * A deterministic fetch transport that serves the graduated Position library's
 * published snapshot from the on-disk fixture, for the coordinate and pin the
 * catalog move names. Every other repository, pin, branch, or path answers as
 * absent, so a host install exercises the `gh:` fetch path without touching the
 * network.
 */
export function createCodalPositionFixtureTransport(): ExtensionFetchTransport {
  const parsed = parseExtensionReference(CODAL_POSITION_GH_REF);
  if (parsed?.transport !== "gh" || parsed.routing.kind !== "pin") {
    throw new Error(`the Position move ref "${CODAL_POSITION_GH_REF}" is not a pinned gh: reference`);
  }
  const { owner, repo, routing } = parsed;
  const encoder = new TextEncoder();
  return {
    async fetchFile(fileOwner: string, fileRepo: string, pin: string, path: string): Promise<ExtensionFetchFileResult> {
      const content = FIXTURE_FILES[path];
      if (fileOwner !== owner || fileRepo !== repo || pin !== routing.pin || content === undefined) {
        return { ok: false, kind: "not-found" };
      }
      return { ok: true, content: encoder.encode(content) };
    },
    async resolveBranch(): Promise<ExtensionFetchBranchResult> {
      return { ok: false, kind: "not-found" };
    },
    async listVersionTags(): Promise<ExtensionVersionListResult> {
      return { ok: true, versions: ["0.1.4"] };
    },
  };
}
