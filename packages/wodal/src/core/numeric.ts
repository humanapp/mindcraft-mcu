/** Largest value representable by an unsigned 8-bit device field. */
export const UINT8_MAX = 0xff;

/** Largest value representable by an unsigned 16-bit device field. */
export const UINT16_MAX = 0xffff;

/** Largest value representable by an unsigned 32-bit device field. */
export const UINT32_MAX = 0xffffffff;

/** Lowest value representable by a signed 16-bit device field. */
export const INT16_MIN = -0x8000;

/** Largest value representable by a signed 16-bit device field. */
export const INT16_MAX = 0x7fff;

/** Lowest value representable by a signed 32-bit device field. */
export const INT32_MIN = -0x80000000;

/** Largest value representable by a signed 32-bit device field. */
export const INT32_MAX = 0x7fffffff;

/** Numeric value normalized to unsigned 8-bit device storage. */
export type Uint8 = number;

/** Numeric value normalized to unsigned 16-bit device storage. */
export type Uint16 = number;

/** Numeric value normalized to unsigned 32-bit device storage. */
export type Uint32 = number;

/** Numeric value normalized to signed 16-bit device storage. */
export type Int16 = number;

/** Numeric value normalized to signed 32-bit device storage. */
export type Int32 = number;

/**
 * Converts a JavaScript number to unsigned 8-bit storage.
 *
 * @param value - Input number.
 * @returns Integer value in the range 0..255.
 */
export function toUint8(value: number): Uint8 {
  return finiteInteger(value) & UINT8_MAX;
}

/**
 * Converts a JavaScript number to unsigned 16-bit storage.
 *
 * @param value - Input number.
 * @returns Integer value in the range 0..65535.
 */
export function toUint16(value: number): Uint16 {
  return finiteInteger(value) & UINT16_MAX;
}

/**
 * Converts a JavaScript number to unsigned 32-bit storage.
 *
 * @param value - Input number.
 * @returns Integer value in the range 0..4294967295.
 */
export function toUint32(value: number): Uint32 {
  return finiteInteger(value) >>> 0;
}

/**
 * Converts a JavaScript number to signed 16-bit storage.
 *
 * @param value - Input number.
 * @returns Integer value in the range -32768..32767.
 */
export function toInt16(value: number): Int16 {
  const unsigned = toUint16(value);
  return unsigned > INT16_MAX ? unsigned - 0x10000 : unsigned;
}

/**
 * Converts a JavaScript number to signed 32-bit storage.
 *
 * @param value - Input number.
 * @returns Integer value in the range -2147483648..2147483647.
 */
export function toInt32(value: number): Int32 {
  return finiteInteger(value) | 0;
}

/**
 * Clamps a JavaScript number to unsigned 8-bit range.
 *
 * @param value - Input number.
 * @returns Integer value in the range 0..255.
 */
export function clampUint8(value: number): Uint8 {
  return clampInteger(value, 0, UINT8_MAX);
}

/**
 * Clamps a JavaScript number to unsigned 32-bit range.
 *
 * @param value - Input number.
 * @returns Integer value in the range 0..4294967295.
 */
export function clampUint32(value: number): Uint32 {
  return clampInteger(value, 0, UINT32_MAX);
}

/**
 * Clamps a JavaScript number to signed 16-bit range.
 *
 * @param value - Input number.
 * @returns Integer value in the range -32768..32767.
 */
export function clampInt16(value: number): Int16 {
  return clampInteger(value, INT16_MIN, INT16_MAX);
}

/**
 * Clamps a JavaScript number to signed 32-bit range.
 *
 * @param value - Input number.
 * @returns Integer value in the range -2147483648..2147483647.
 */
export function clampInt32(value: number): Int32 {
  return clampInteger(value, INT32_MIN, INT32_MAX);
}

/**
 * Converts a JavaScript number to a non-negative integer.
 *
 * @param value - Input number.
 * @returns Integer greater than or equal to zero.
 */
export function toNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
}

function finiteInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, finiteInteger(value)));
}
