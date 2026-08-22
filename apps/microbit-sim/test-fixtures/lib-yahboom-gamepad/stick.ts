import { type Context, modifier, optional, Sensor } from "wendoo";
import { DIRECTION_DOWN, DIRECTION_LEFT, DIRECTION_RIGHT, DIRECTION_UP, readStickDirection } from "./stick-read";

/**
 * Reports the thumb stick's discrete direction. Each optional direction word may
 * appear at most once, in any subset; the tile is true while the stick's current
 * direction matches any word placed (`[stick][up][left]` = up or left). With no
 * word it is true for any direction. A pressed stick reports no direction, so
 * every direction reads false while the stick is pressed.
 *
 * The direction words reuse the shared `modifier.direction.*` namespace, so
 * left/right are the same words the Cutebot movement tiles use.
 */
export default Sensor({
  name: "stick",
  id: "qyPhWctORp9bXYAc",
  icon: "./icons/stick.svg",
  docs: "./docs/stick.md",
  args: [
    optional(modifier("modifier.direction.up", { label: "up" })),
    optional(modifier("modifier.direction.down", { label: "down" })),
    optional(modifier("modifier.direction.left", { label: "left" })),
    optional(modifier("modifier.direction.right", { label: "right" })),
  ],
  onExecute(ctx: Context, args: { up: boolean; down: boolean; left: boolean; right: boolean }): boolean {
    const direction = readStickDirection(ctx);
    if (!args.up && !args.down && !args.left && !args.right) {
      return direction !== "none";
    }
    if (args.up && direction === DIRECTION_UP) {
      return true;
    }
    if (args.down && direction === DIRECTION_DOWN) {
      return true;
    }
    if (args.left && direction === DIRECTION_LEFT) {
      return true;
    }
    if (args.right && direction === DIRECTION_RIGHT) {
      return true;
    }
    return false;
  },
});
