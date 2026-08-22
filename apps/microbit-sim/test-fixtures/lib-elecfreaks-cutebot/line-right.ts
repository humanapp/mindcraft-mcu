import { type Context, choice, modifier, optional, Sensor } from "wendoo";
import { CutebotLine } from "./line-sensor";

/**
 * Reports the Cutebot right line sensor. A mutually-exclusive modifier selects
 * what it reports; with no modifier it reports "on":
 * - "found": true for the one think the sensor crossed onto the line.
 * - "lost": true for the one think the sensor crossed off the line.
 * - "on": true while the sensor is over the line.
 */
export default Sensor({
  name: "cutebot line (right)",
  id: "O589P92kylCpz3tv",
  icon: "./icons/line-right.svg",
  docs: "./docs/line-right.md",
  args: [
    // Modifiers use the shared "modifier.cutebot-line" namespace, matched by the
    // left line sensor so the same modifier is valid on either.
    optional(
      choice(
        modifier("modifier.cutebot-line.found", { label: "found" }),
        modifier("modifier.cutebot-line.lost", { label: "lost" }),
        modifier("modifier.cutebot-line.on", { label: "on" })
      )
    ),
  ],
  onExecute(ctx: Context, args: { found: boolean; lost: boolean; on: boolean }): boolean {
    if (args.found) {
      return CutebotLine.rightFound();
    }
    if (args.lost) {
      return CutebotLine.rightLost();
    }
    return CutebotLine.right();
  },
});
