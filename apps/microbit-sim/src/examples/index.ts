import type { ExampleDefinition } from "@mindcraft-lang/bridge-app";

/**
 * Groups raw `./<folder>/<path> -> content` entries (the shape returned by the
 * bundler's `?raw` glob) into one {@link ExampleDefinition} per top-level folder.
 * The `index.ts` entry and any file not nested under a folder are ignored.
 */
export function groupExampleFiles(raw: Record<string, string>): ExampleDefinition[] {
  const groups = new Map<string, { path: string; content: string }[]>();

  for (const [key, content] of Object.entries(raw)) {
    const match = key.match(/^\.\/([^/]+)\/(.+)$/);
    if (!match || match[1] === "index.ts") continue;

    const folder = match[1];
    const path = match[2];

    let files = groups.get(folder);
    if (!files) {
      files = [];
      groups.set(folder, files);
    }
    files.push({ path, content });
  }

  const result: ExampleDefinition[] = [];
  for (const [folder, files] of groups) {
    result.push({ folder, files });
  }
  return result;
}

/** Loads the bundled example projects as {@link ExampleDefinition}s for injection into the project compiler. */
export function loadExamples(): ExampleDefinition[] {
  const raw = import.meta.glob("./**/*", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  return groupExampleFiles(raw);
}
