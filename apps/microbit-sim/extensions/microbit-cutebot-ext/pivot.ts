import { Actuator, type Context, choice, modifier, optional, repeated } from "mindcraft";
import { Movement, rateFromWords } from "./movement";

/**
 * Spins the Cutebot in place by adding a counter-rotate influence to the
 * shared {@link Movement} arbitrator: the wheels drive at the rate in opposite
 * directions. The bare tile pivots right at the normal rate; up to three
 * `slowly` or `quickly` words step the rate down or up the ladder, and the
 * optional direction word picks the side.
 */
export default Actuator({
  name: "cutebot pivot",
  id: "UnyIyxxcQ7EPnbAQ",
  args: [
    // Rate words use the shared "modifier.speed" namespace, matched by the
    // drive and turn tiles so a rate word is valid on any movement tile.
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
    Movement.pivot(args.left ? -rate : rate);
  },
});
