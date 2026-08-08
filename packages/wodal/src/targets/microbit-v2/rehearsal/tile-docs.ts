import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TileDocContent } from "@mindcraft-lang/assistant-bridge/kit";
import { pairTileDocs, readTileDocContent } from "@mindcraft-lang/assistant-bridge/kit";
import { MICROBIT_V2_TILE_DOCS } from "../mindcraft/tile-docs";

/** Directory this module was loaded from, whether from source or from the built artifact. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** This target's own directory name, shared by its source tree and its shipped docs tree. */
const TARGET_DIR_NAME = basename(join(MODULE_DIR, ".."));

/** Package root, four levels above this module in both trees. */
const PACKAGE_DIR = join(MODULE_DIR, "..", "..", "..", "..");

/** Directory holding this target's shipped English tile documentation. */
const TILE_DOC_DIR = join(PACKAGE_DIR, "targets", TARGET_DIR_NAME, "docs", "en", "tiles");

/** The documentation content the artifact carries, or the package's own shipped tree in a source run. */
function tileDocContent(): TileDocContent {
  return typeof TILE_DOC_CONTENT === "object" ? TILE_DOC_CONTENT : readTileDocContent(TILE_DOC_DIR);
}

/**
 * The English documentation this target ships for its own tiles, as raw
 * markdown keyed by tile id. Throws when the manifest and the shipped content
 * disagree: every manifest entry must resolve to shipped content, and every
 * shipped file must be named by an entry.
 */
export function microBitV2TileDocs(): Map<string, string> {
  const content = tileDocContent();
  const docs = pairTileDocs(content, MICROBIT_V2_TILE_DOCS);

  const unresolved = MICROBIT_V2_TILE_DOCS.filter((entry) => !docs.has(entry.tileId)).map((entry) => entry.contentKey);
  const unmapped = Object.keys(content).filter(
    (key) => !MICROBIT_V2_TILE_DOCS.some((entry) => entry.contentKey === key)
  );
  if (unresolved.length > 0 || unmapped.length > 0) {
    throw new Error(
      "the shipped tile documentation does not pair with the tile doc manifest: " +
        `${unresolved.length} entries name no content (${unresolved.join(", ")}), ` +
        `${unmapped.length} files are named by no entry (${unmapped.join(", ")})`
    );
  }
  return docs;
}
