import { Actuator, type Context } from "mindcraft";

/** Cutebot STM8 motor-driver I2C address (7-bit). */
const CUTEBOT_ADDRESS = 0x10;

/**
 * Halts both Cutebot wheels.
 *
 * Each wheel is set with one 4-byte I2C command to the STM8 motor driver at
 * {@link CUTEBOT_ADDRESS}: `[wheel, direction, speed, pad]` with a zero speed.
 * Bytes transcribed from ELECFREAKS pxt-cutebot `motors(0, 0)`.
 */
export default Actuator({
  name: "cutebot stop",
  onExecute(ctx: Context): void {
    ctx.microbit.i2c.writeBuffer(CUTEBOT_ADDRESS, Buffer.from([0x01, 0x01, 0x00, 0x00]));
    ctx.microbit.i2c.writeBuffer(CUTEBOT_ADDRESS, Buffer.from([0x02, 0x01, 0x00, 0x00]));
  },
});
