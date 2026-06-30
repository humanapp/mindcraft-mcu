import { Actuator, type Context } from "mindcraft";

/** Cutebot STM8 motor-driver I2C address (7-bit). */
const CUTEBOT_ADDRESS = 0x10;

/** Forward speed as a percent (0-100). */
const DRIVE_SPEED = 50;

/**
 * Drives a Cutebot straight forward at {@link DRIVE_SPEED}.
 *
 * Each wheel is set with one 4-byte I2C command to the STM8 motor driver at
 * {@link CUTEBOT_ADDRESS}: `[wheel, direction, speed, pad]`, where `wheel` is
 * 0x01 (left) or 0x02 (right), `direction` is 0x02 (forward) or 0x01 (reverse),
 * `speed` is 0-100, and `pad` is unused. Bytes transcribed from ELECFREAKS
 * pxt-cutebot `motors()` / `forward()`.
 */
export default Actuator({
  name: "cutebot drive",
  onExecute(ctx: Context): void {
    ctx.microbit.i2c.writeBuffer(CUTEBOT_ADDRESS, Buffer.from([0x01, 0x02, DRIVE_SPEED, 0x00]));
    ctx.microbit.i2c.writeBuffer(CUTEBOT_ADDRESS, Buffer.from([0x02, 0x02, DRIVE_SPEED, 0x00]));
  },
});
