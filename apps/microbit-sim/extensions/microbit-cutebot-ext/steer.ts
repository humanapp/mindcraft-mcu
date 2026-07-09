import { Actuator, type Context, NumberType, param } from "mindcraft";
import { Movement } from "./movement";

/**
 * Steers the Cutebot from a continuous `x` (horizontal) and `y` (vertical)
 * pair, each -100..100 in game convention. It feeds `y` to the shared
 * {@link Movement} arbitrator as a straight drive and `x` as a turn, so the two
 * blend into an arc: full up-right is forward with a rightward push. Both axes
 * already share the movement influence range, so they pass through unscaled; the
 * arbitrator saturates the blend. This is the numeric bridge continuous steering
 * needs - the word-rated drive/turn tiles take no numeric argument.
 */
export default Actuator({
  name: "cutebot steer",
  id: "mwQw6UokYjp3HVBD",
  args: [param("x", { type: NumberType, anonymous: true }), param("y", { type: NumberType, anonymous: true })],
  onExecute(ctx: Context, args: { x: number; y: number }): void {
    Movement.drive(args.y);
    Movement.turn(args.x);
  },
});
