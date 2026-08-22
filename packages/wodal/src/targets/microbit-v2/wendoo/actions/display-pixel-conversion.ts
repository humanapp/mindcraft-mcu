/**
 * f32 -> CODAL-parameter conversions the display set-pixel write applies before
 * crossing the device port. The micro:bit display is driven by CODAL
 * `Image::setPixelValue(int16_t x, int16_t y, uint8_t value)`, so a coordinate
 * narrows to int16 and a brightness narrows to uint8; the device drops a write
 * whose coordinate is outside the matrix. The C++ VM applies the identical rule
 * (cpp/targets/microbit-v2/abi/host-binding-conversions.h), documented in
 * docs/specs/contracts/observable-trace.md.
 */

/**
 * Narrows a pixel coordinate to CODAL's int16 parameter: non-finite values
 * become 0; finite values truncate toward zero and narrow to int16. Range
 * validity (0..matrix dimension) is enforced downstream by the device.
 *
 * @param value - Coordinate from the VM, at the profile's number precision.
 * @returns The int16 coordinate.
 */
export function pixelCoordToPort(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return (Math.trunc(value) << 16) >> 16;
}

/**
 * Narrows a brightness to CODAL's uint8 value parameter: non-finite values
 * become 0; finite values truncate toward zero and narrow to uint8 (no clamp).
 *
 * @param value - Brightness from the VM, at the profile's number precision.
 * @returns Integer brightness in 0..255.
 */
export function brightnessToPort(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value) & 0xff;
}
