import { Position } from "@lib/mindcraft-lang/lib-codal-position";
import { Actuator, type Context, param } from "mindcraft";
import { Movement } from "./movement";

/**
 * Steers the Cutebot from a {@link Position}. The position's `y` axis drives the
 * shared {@link Movement} arbitrator straight ahead and its `x` axis turns it, so
 * a forward-right position becomes a forward drive blended with a rightward turn.
 * Both axes are in the -100..100 movement influence range and pass through
 * unscaled; the arbitrator saturates the combined blend.
 */
export default Actuator({
  name: "cutebot steer",
  id: "mwQw6UokYjp3HVBD",
  icon: "./icons/steer.svg",
  docs: "./docs/steer.md",
  args: [param("position", { type: Position, anonymous: true })],
  onExecute(ctx: Context, args: { position: Position }): void {
    Movement.drive(args.position.y);
    Movement.turn(args.position.x);
  },
});
