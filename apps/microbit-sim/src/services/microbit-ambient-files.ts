import coreAmbientContent from "@mindcraft-lang/core/ambient/mindcraft.core.d.ts?raw";
import type { AmbientFile } from "@mindcraft-lang/ts-compiler";
import microbitAmbientContent from "@mindcraft-lang/wodal/ambient/mindcraft.microbit-v2.d.ts?raw";
import wodalAmbientContent from "@mindcraft-lang/wodal/ambient/mindcraft.wodal.d.ts?raw";

/** Ambient declaration files exposed to the user-code compiler. */
export const microbitAmbientFiles: readonly AmbientFile[] = [
  { path: "mindcraft.core.d.ts", content: coreAmbientContent },
  { path: "mindcraft.wodal.d.ts", content: wodalAmbientContent },
  { path: "mindcraft.microbit-v2.d.ts", content: microbitAmbientContent },
];
