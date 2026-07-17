import { type Context, modifier, optional, Sensor } from "mindcraft";
import { BUTTON_BLUE_PIN, BUTTON_GREEN_PIN, BUTTON_RED_PIN, BUTTON_YELLOW_PIN, readButtonPressed } from "./stick-read";

/**
 * Reports the four colored buttons: red = B1, green = B2, blue = B3,
 * yellow = B4, each LOW-active. Each optional color word may appear at most
 * once, in any subset; the tile is true while any button whose color is placed
 * is held (`[button][red][blue]` = red or blue). With no word it is true while
 * any button is held.
 *
 * The color words use the shared `modifier.color.*` namespace.
 */
export default Sensor({
  name: "button",
  id: "bt6WY8kcZymPzSAA",
  args: [
    optional(modifier("modifier.color.red", { label: "red" })),
    optional(modifier("modifier.color.green", { label: "green" })),
    optional(modifier("modifier.color.blue", { label: "blue" })),
    optional(modifier("modifier.color.yellow", { label: "yellow" })),
  ],
  onExecute(ctx: Context, args: { red: boolean; green: boolean; blue: boolean; yellow: boolean }): boolean {
    const redHeld = readButtonPressed(ctx, BUTTON_RED_PIN);
    const greenHeld = readButtonPressed(ctx, BUTTON_GREEN_PIN);
    const blueHeld = readButtonPressed(ctx, BUTTON_BLUE_PIN);
    const yellowHeld = readButtonPressed(ctx, BUTTON_YELLOW_PIN);
    if (!args.red && !args.green && !args.blue && !args.yellow) {
      return redHeld || greenHeld || blueHeld || yellowHeld;
    }
    return (args.red && redHeld) || (args.green && greenHeld) || (args.blue && blueHeld) || (args.yellow && yellowHeld);
  },
});
