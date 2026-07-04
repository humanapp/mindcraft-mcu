import { BufferType, type Context, Sensor } from "mindcraft";
import { Position } from "./position";
import { PACKET_MAGIC } from "./protocol";

/**
 * Decodes the received gamepad state packet - the enclosing WHEN's captured
 * value, read with `ctx.getWhenResult()` - into a {@link Position} and returns
 * it inline, so under a `radio receive buffer` rule it decodes the received
 * bytes with no wiring. It is total: a valid packet (magic byte present, at
 * least three bytes) decodes to `{ x, y }`; anything else - no packet, wrong
 * magic, too short - returns the centered position `(0, 0)`, the idle-stick
 * value, never nil. Read the fields through the accessor tiles. It takes no
 * argument: a value sensor read inline through accessors cannot also carry a
 * value argument.
 */
export default Sensor({
  name: "decoded stick position",
  returnType: Position,
  consumesWhenResult: BufferType,
  inline: true,
  onExecute(ctx: Context): Position {
    const packet = ctx.getWhenResult();
    if (Buffer.isBuffer(packet) && packet.length() >= 3 && packet.get(0) === PACKET_MAGIC) {
      return Position({ x: packet.get(1) - 100, y: packet.get(2) - 100 });
    }
    return Position({ x: 0, y: 0 });
  },
});
