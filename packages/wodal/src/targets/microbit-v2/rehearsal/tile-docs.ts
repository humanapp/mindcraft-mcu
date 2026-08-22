import { pairTileDocs } from "@wendoo/assistant-bridge/kit";
import { MICROBIT_V2_TILE_DOC_CONTENT } from "../wendoo/_generated/tile-doc-content";
import { MICROBIT_V2_TILE_DOCS } from "../wendoo/tile-docs";

/**
 * The English documentation this target ships for its own tiles, as raw
 * markdown keyed by tile id. Throws when the manifest and the shipped content
 * disagree: every manifest entry must resolve to shipped content, and every
 * shipped file must be named by an entry.
 */
export function microBitV2TileDocs(): Map<string, string> {
  const docs = pairTileDocs(MICROBIT_V2_TILE_DOC_CONTENT, MICROBIT_V2_TILE_DOCS);

  const unresolved = MICROBIT_V2_TILE_DOCS.filter((entry) => !docs.has(entry.tileId)).map((entry) => entry.contentKey);
  const unmapped = Object.keys(MICROBIT_V2_TILE_DOC_CONTENT).filter(
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
