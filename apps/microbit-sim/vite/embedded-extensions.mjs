import path from "path";
import { embeddedExtensionsVitePlugin } from "@mindcraft-lang/bridge-app/node";

// The extensions microbit-sim offers, by coordinate and source directory. The
// file list of each comes from its own mindcraft.json, so adding a file to an
// extension needs no change here.
const registrations = [
  {
    coordinate: "mindcraft-lang/trg-microbit-v2",
    dir: path.resolve(process.cwd(), "./target-package"),
  },
  {
    coordinate: "mindcraft-lang/lib-microbit-v2",
    dir: path.resolve(process.cwd(), "../../packages/wodal/targets/microbit-v2/lib"),
  },
  { coordinate: "mindcraft-lang/lib-codal", dir: path.resolve(process.cwd(), "../../packages/wodal/lib") },
  {
    coordinate: "mindcraft-lang/lib-core",
    dir: path.resolve(process.cwd(), "../../external/mindcraft-lang/packages/core/lib"),
  },
  {
    coordinate: "mindcraft-lang/lib-microbit-cutebot",
    dir: path.resolve(process.cwd(), "./extensions/lib-microbit-cutebot"),
  },
  {
    coordinate: "mindcraft-lang/lib-microbit-yahboom-gamepad",
    dir: path.resolve(process.cwd(), "./extensions/lib-microbit-yahboom-gamepad"),
  },
];

export function embeddedExtensions() {
  return embeddedExtensionsVitePlugin(registrations);
}
