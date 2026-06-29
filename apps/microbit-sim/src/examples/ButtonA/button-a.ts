import { type Context, Sensor } from "mindcraft";

export default Sensor({
  name: "button A pressed",
  onExecute(ctx: Context): boolean {
    return ctx.microbit.buttonA.isPressed() !== 0;
  },
});
