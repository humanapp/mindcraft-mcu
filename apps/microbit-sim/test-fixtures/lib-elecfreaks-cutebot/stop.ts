import { Actuator, type Context } from "wendoo";
import { Movement } from "./movement";

/**
 * Issues the shared {@link Movement} arbitrator's exclusive stop: this think
 * discards every movement influence, whether commanded before or after the
 * stop, and writes both wheels to zero, bypassing smoothing. Influences resume
 * normally next think. The canonical use is a safety rule that must win over
 * every concurrently firing movement rule.
 */
export default Actuator({
  name: "cutebot stop",
  id: "U36vDJTcZtUzBsh8",
  icon: "./icons/stop.svg",
  docs: "./docs/stop.md",
  onExecute(ctx: Context): void {
    Movement.stop();
  },
});
