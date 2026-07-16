import { Position } from "@lib/mindcraft-lang/codal-position-ext";
import { type Context, Sensor } from "mindcraft";
import { readStickX, readStickY } from "./stick-read";

/**
 * Reads the thumb stick's continuous position as a {@link Position} value in
 * game convention (`x` right-positive, `y` up-positive, both -100..100). Each
 * evaluation samples both axes fresh and builds a new struct, so the value is
 * live in any expression - including a local game with no radio
 * (`[set dotX [stick position][x]]`). Its `x` / `y` fields are read through the
 * derived accessor tiles.
 */
export default Sensor({
  name: "stick position",
  id: "cz4jLqjYRy2bAwR3",
  returnType: Position,
  inline: true,
  onExecute(ctx: Context): Position {
    return Position({ x: readStickX(ctx), y: readStickY(ctx) });
  },
});
