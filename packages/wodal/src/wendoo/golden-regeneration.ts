import { existsSync } from "node:fs";

/**
 * Environment variable that puts the golden-minting specs into regeneration
 * mode. Set it to `1` to rewrite every derived golden from a fresh build.
 */
export const REGENERATE_GOLDENS_ENV = "WENDOO_REGENERATE_GOLDENS";

/**
 * True when the spec should write the golden at `path`: always in regeneration
 * mode, otherwise only when the golden does not yet exist.
 *
 * Gate the goldens derived from a committed source with this -- the binary
 * encoding and the rendered trace.
 *
 * @param path - Absolute path of the golden the caller is about to write.
 */
export function shouldWriteGolden(path: string): boolean {
  return process.env[REGENERATE_GOLDENS_ENV] === "1" || !existsSync(path);
}
