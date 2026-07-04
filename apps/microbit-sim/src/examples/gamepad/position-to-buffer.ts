import { BufferType, Conversion } from "mindcraft";
import { Position } from "./position";
import { PACKET_MAGIC } from "./protocol";

/**
 * Encodes a {@link Position} as the three-byte gamepad state packet
 * `[PACKET_MAGIC, x + 100, y + 100]`, offsetting the -100..100 axes to the
 * 0..200 byte range. Registered as an implicit conversion, so a position fills
 * any Buffer-expected slot - `[radio send [stick position]]` broadcasts the
 * stick with no explicit encode step. Decoding is deliberately not a conversion:
 * an arbitrary buffer is not a position (see the decoder tile).
 */
export default Conversion({
  from: Position,
  to: BufferType,
  cost: 2,
  convert(pos: Position): Buffer {
    return Buffer.from([PACKET_MAGIC, pos.x + 100, pos.y + 100]);
  },
});
