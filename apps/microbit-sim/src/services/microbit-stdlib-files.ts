import type { StdlibSourceFile } from "@mindcraft-lang/ts-compiler";
import imageStdlibContent from "@mindcraft-lang/wodal/stdlib/targets/microbit-v2/image.ts?raw";

/** Compilable target stdlib source modules exposed to the user-code compiler and synced into the workspace. */
export const microbitStdlibFiles: readonly StdlibSourceFile[] = [
  { path: "stdlib/image.ts", content: imageStdlibContent },
];
