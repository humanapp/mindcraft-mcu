import path from "path";
import { embeddedExtensionsVitePlugin } from "@mindcraft-lang/bridge-app/node";

// The extensions microbit-sim offers, by coordinate and source directory. The
// file list of each comes from its own mindcraft.json, so adding a file to an
// extension needs no change here.
const registrations = [
  {
    coordinate: "mindcraft-lang/microbit-v2",
    dir: path.resolve(process.cwd(), "../../packages/wodal/targets/microbit-v2/lib"),
  },
  { coordinate: "mindcraft-lang/codal", dir: path.resolve(process.cwd(), "../../packages/wodal/lib") },
  {
    coordinate: "mindcraft-lang/core",
    dir: path.resolve(process.cwd(), "../../external/mindcraft-lang/packages/core/lib"),
  },
  {
    coordinate: "mindcraft-lang/codal-position-ext",
    dir: path.resolve(process.cwd(), "./extensions/codal-position-ext"),
  },
  {
    coordinate: "mindcraft-lang/microbit-cutebot-ext",
    dir: path.resolve(process.cwd(), "./extensions/microbit-cutebot-ext"),
  },
  {
    coordinate: "mindcraft-lang/microbit-yahboom-gamepad-ext",
    dir: path.resolve(process.cwd(), "./extensions/microbit-yahboom-gamepad-ext"),
  },
];

export function embeddedExtensions() {
  return embeddedExtensionsVitePlugin(registrations);
}
