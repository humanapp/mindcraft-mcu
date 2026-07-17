import { Actuator, type Context, choice, modifier, optional, repeated } from "mindcraft";
import { Movement, rateFromWords } from "./movement";

/**
 * Drives the Cutebot straight by adding a both-wheels influence to the shared
 * {@link Movement} arbitrator. The bare tile drives forward at the normal
 * rate; up to three `slowly` or `quickly` words step the rate down or up the
 * ladder, and the optional direction word reverses. A rule keeps the robot
 * driving by firing every think; when no movement rule fires, the robot stops.
 */
export default Actuator({
  name: "cutebot drive",
  id: "zClgsu5drwdekq7r",
  icon: "./icons/drive.svg",
  docs: "./docs/drive.md",
  args: [
    // Rate words use the shared "modifier.speed" namespace, matched by the
    // turn and pivot tiles so a rate word is valid on any movement tile.
    optional(
      choice(
        repeated(modifier("modifier.speed.slowly", { label: "slowly" }), { min: 1, max: 3 }),
        repeated(modifier("modifier.speed.quickly", { label: "quickly" }), { min: 1, max: 3 })
      )
    ),
    optional(
      choice(
        modifier("modifier.direction.forward", { label: "forward" }),
        modifier("modifier.direction.backward", { label: "backward" })
      )
    ),
  ],
  onExecute(ctx: Context, args: { slowly: number; quickly: number; forward: boolean; backward: boolean }): void {
    const slowly = args.slowly ? args.slowly : 0;
    const quickly = args.quickly ? args.quickly : 0;
    const rate = rateFromWords(slowly, quickly);
    Movement.drive(args.backward ? -rate : rate);
  },
});
