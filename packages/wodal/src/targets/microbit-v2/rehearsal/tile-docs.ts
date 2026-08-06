import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTileDocs } from "@mindcraft-lang/assistant-bridge/kit";
import { MICROBIT_V2_TILE_DOCS } from "../mindcraft/tile-docs";

/** Directory this module was loaded from, whether from source or from the built artifact. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** This target's own directory name, shared by its source tree and its shipped docs tree. */
const TARGET_DIR_NAME = basename(join(MODULE_DIR, ".."));

/** Package root, four levels above this module in both trees. */
const PACKAGE_DIR = join(MODULE_DIR, "..", "..", "..", "..");

/** Directory holding this target's shipped English tile documentation. */
const TILE_DOC_DIR = join(PACKAGE_DIR, "targets", TARGET_DIR_NAME, "docs", "en", "tiles");

/** Base name, without its `.md` extension, of every markdown file in the docs directory. */
function shippedContentKeys(): string[] {
  return readdirSync(TILE_DOC_DIR)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));
}

/**
 * The English documentation this target ships for its own tiles, as raw
 * markdown keyed by tile id. Throws when the manifest and the docs directory
 * disagree: every manifest entry must resolve to a shipped file, and every
 * shipped file must be named by an entry.
 */
export function microBitV2TileDocs(): Map<string, string> {
  const docs = readTileDocs(TILE_DOC_DIR, MICROBIT_V2_TILE_DOCS);

  const unresolved = MICROBIT_V2_TILE_DOCS.filter((entry) => !docs.has(entry.tileId)).map((entry) => entry.contentKey);
  const shipped = shippedContentKeys();
  const unmapped = shipped.filter((key) => !MICROBIT_V2_TILE_DOCS.some((entry) => entry.contentKey === key));
  if (unresolved.length > 0 || unmapped.length > 0) {
    throw new Error(
      `${TILE_DOC_DIR} does not pair with the tile doc manifest: ` +
        `${unresolved.length} entries name no file (${unresolved.join(", ")}), ` +
        `${unmapped.length} files are named by no entry (${unmapped.join(", ")})`
    );
  }
  return docs;
}
