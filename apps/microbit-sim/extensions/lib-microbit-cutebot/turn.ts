import { Actuator, type Context, choice, modifier, optional, repeated } from "mindcraft";
import { Movement, rateFromWords } from "./movement";

/**
 * Turns the Cutebot by adding an outer-wheel influence to the shared
 * {@link Movement} arbitrator: the wheel opposite the turn drives at the rate
 * while the held wheel stays at rest, so a turn alone creeps forward in an
 * arc. The bare tile turns right at the normal rate; up to three `slowly` or
 * `quickly` words step the rate down or up the ladder, and the optional
 * direction word picks the side.
 */
export default Actuator({
  name: "cutebot turn",
  id: "YyDmW7SHlAHCNJIU",
  args: [
    // Rate words use the shared "modifier.speed" namespace, matched by the
    // drive and pivot tiles so a rate word is valid on any movement tile.
    optional(
      choice(
        repeated(modifier("modifier.speed.slowly", { label: "slowly" }), { min: 1, max: 3 }),
        repeated(modifier("modifier.speed.quickly", { label: "quickly" }), { min: 1, max: 3 })
      )
    ),
    optional(
      choice(
        modifier("modifier.direction.left", { label: "left" }),
        modifier("modifier.direction.right", { label: "right" })
      )
    ),
  ],
  onExecute(ctx: Context, args: { slowly: number; quickly: number; left: boolean; right: boolean }): void {
    const slowly = args.slowly ? args.slowly : 0;
    const quickly = args.quickly ? args.quickly : 0;
    const rate = rateFromWords(slowly, quickly);
    Movement.turn(args.left ? -rate : rate);
  },
});
