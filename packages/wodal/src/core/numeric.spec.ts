import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampInt16,
  clampInt32,
  clampUint8,
  clampUint32,
  toInt16,
  toInt32,
  toNonNegativeInteger,
  toUint8,
  toUint16,
  toUint32,
  UINT8_MAX,
  UINT16_MAX,
  UINT32_MAX,
} from "./numeric";

describe("numeric device conversions", () => {
  it("wraps unsigned device storage values", () => {
    assert.equal(toUint8(256), 0);
    assert.equal(toUint8(-1), UINT8_MAX);
    assert.equal(toUint16(65536), 0);
    assert.equal(toUint16(-1), UINT16_MAX);
    assert.equal(toUint32(UINT32_MAX + 1), 0);
    assert.equal(toUint32(-1), UINT32_MAX);
  });

  it("wraps signed device storage values", () => {
    assert.equal(toInt16(32768), -32768);
    assert.equal(toInt16(65535), -1);
    assert.equal(toInt32(2147483648), -2147483648);
    assert.equal(toInt32(4294967295), -1);
  });

  it("clamps bounded physical values", () => {
    assert.equal(clampUint8(-10), 0);
    assert.equal(clampUint8(300), UINT8_MAX);
    assert.equal(clampUint32(-10), 0);
    assert.equal(clampUint32(Number.POSITIVE_INFINITY), 0);
    assert.equal(clampInt16(-40000), -32768);
    assert.equal(clampInt16(40000), 32767);
    assert.equal(clampInt32(-3000000000), -2147483648);
    assert.equal(clampInt32(3000000000), 2147483647);
  });

  it("normalizes non-negative counts", () => {
    assert.equal(toNonNegativeInteger(-1), 0);
    assert.equal(toNonNegativeInteger(2.9), 2);
    assert.equal(toNonNegativeInteger(Number.NaN), 0);
  });
});
