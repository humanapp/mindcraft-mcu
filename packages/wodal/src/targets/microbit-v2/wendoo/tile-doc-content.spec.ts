import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MICROBIT_V2_TILE_DOC_CONTENT } from "./_generated/tile-doc-content";

/** Directory holding the target's shipped English tile documentation. */
const CONTENT_DIR = fileURLToPath(new URL("../../../../targets/microbit-v2/docs/en/tiles", import.meta.url));

/** Every `.md` file in `directory` as raw markdown keyed by content key. */
function readMarkdown(directory: string): Record<string, string> {
  const content: Record<string, string> = {};
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith(".md")) continue;
    content[file.slice(0, -3)] = readFileSync(join(directory, file), "utf8");
  }
  return content;
}

describe("the carried tile documentation", () => {
  test("matches the markdown files this package ships", () => {
    assert.deepEqual(
      { ...MICROBIT_V2_TILE_DOC_CONTENT },
      readMarkdown(CONTENT_DIR),
      "run `npm run generate:tile-docs` after editing the microbit-v2 tile docs"
    );
  });
});
