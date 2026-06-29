/**
 * Unit tests for the MakeCode radio wire format and the receive ring. The
 * wire tests pin the byte-for-byte interop contract (encode matches the
 * `pxt-common-packages` `libs/radio` layout; decode reads it back), and the
 * ring tests pin the per-cursor delivery, non-consuming reads, overflow
 * eviction, and group filtering the sensors and Device API rely on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeRadioFrame,
  encodeRadioFrame,
  RADIO_MAX_PACKET_SIZE,
  type RADIO_RAW_PACKET_TYPE,
  Radio,
  RadioPacketType,
  type RadioSendRecord,
  radioNumberIsInteger,
} from "./radio";

const EMPTY = new Uint8Array(0);

function record(partial: Partial<RadioSendRecord> & Pick<RadioSendRecord, "type">): RadioSendRecord {
  return { group: 0, value: 0, name: "", text: "", bytes: EMPTY, ...partial };
}

function int32LE(value: number): readonly number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

test("radioNumberIsInteger mirrors MakeCode's value === (value | 0) predicate", () => {
  assert.equal(radioNumberIsInteger(0), true);
  assert.equal(radioNumberIsInteger(42), true);
  assert.equal(radioNumberIsInteger(-7), true);
  assert.equal(radioNumberIsInteger(3.5), false);
  assert.equal(radioNumberIsInteger(2 ** 31), false); // overflows int32, so DOUBLE
});

test("a NUMBER frame matches the MakeCode layout byte-for-byte", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Number, value: 42 }), 1000, 0);
  assert.equal(frame.length, RADIO_MAX_PACKET_SIZE);
  assert.equal(frame[0], RadioPacketType.Number);
  assert.deepEqual(Array.from(frame.subarray(1, 5)), int32LE(1000)); // system time
  assert.deepEqual(Array.from(frame.subarray(5, 9)), int32LE(0)); // serial
  assert.deepEqual(Array.from(frame.subarray(9, 13)), int32LE(42)); // Int32LE payload at offset 9
});

test("a DOUBLE frame carries a Float64LE payload at offset 9", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Double, value: 3.5 }), 0, 0);
  assert.equal(frame[0], RadioPacketType.Double);
  const view = new DataView(frame.buffer);
  assert.equal(view.getFloat64(9, true), 3.5);
});

test("a STRING frame is length-prefixed UTF-8 at offset 9", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.String, text: "hi" }), 0, 0);
  assert.equal(frame[0], RadioPacketType.String);
  assert.equal(frame[9], 2); // length byte
  assert.deepEqual(Array.from(frame.subarray(10, 12)), [0x68, 0x69]); // "hi"
});

test("a VALUE frame carries Int32LE at 9 and a name length-prefixed at offset 13", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Value, value: 5, name: "x" }), 0, 0);
  assert.equal(frame[0], RadioPacketType.Value);
  assert.deepEqual(Array.from(frame.subarray(9, 13)), int32LE(5));
  assert.equal(frame[13], 1); // name length
  assert.equal(frame[14], 0x78); // "x"
});

test("a DOUBLE_VALUE frame carries Float64LE at 9 and a name length-prefixed at offset 17", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.DoubleValue, value: 1.5, name: "yy" }), 0, 0);
  assert.equal(frame[0], RadioPacketType.DoubleValue);
  const view = new DataView(frame.buffer);
  assert.equal(view.getFloat64(9, true), 1.5);
  assert.equal(frame[17], 2); // name length
  assert.deepEqual(Array.from(frame.subarray(18, 20)), [0x79, 0x79]); // "yy"
});

test("a BUFFER frame is length-prefixed bytes at offset 9, truncated to 19", () => {
  const long = new Uint8Array(25).map((_v, i) => i + 1);
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Buffer, bytes: long }), 0, 0);
  assert.equal(frame[0], RadioPacketType.Buffer);
  assert.equal(frame[9], 19); // capped at MAX_PAYLOAD_LENGTH - 1
  assert.deepEqual(Array.from(frame.subarray(10, 29)), Array.from(long.subarray(0, 19)));
});

test("an over-long VALUE name truncates to 8 bytes", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Value, value: 0, name: "abcdefghij" }), 0, 0);
  assert.equal(frame[13], 8);
});

test("decode reads back an encoded NUMBER, narrowing to f32", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Number, value: 1234 }), 50, 0);
  const decoded = decodeRadioFrame(frame, 0, -42);
  assert.equal(decoded.type, RadioPacketType.Number);
  assert.equal(decoded.value, 1234);
  assert.equal(decoded.time, 50);
  assert.equal(decoded.rssi, -42);
});

test("decode narrows a DOUBLE payload to f32", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Double, value: 0.1 }), 0, 0);
  const decoded = decodeRadioFrame(frame, 0, 0);
  assert.equal(decoded.value, Math.fround(0.1));
});

test("decode reads back a VALUE name and number", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.Value, value: 9, name: "ax" }), 0, 0);
  const decoded = decodeRadioFrame(frame, 0, 0);
  assert.equal(decoded.value, 9);
  assert.equal(decoded.name, "ax");
});

test("decode reads back a STRING payload", () => {
  const frame = encodeRadioFrame(record({ type: RadioPacketType.String, text: "hello" }), 0, 0);
  assert.equal(decodeRadioFrame(frame, 0, 0).text, "hello");
});

test("a fixed MakeCode NUMBER byte sequence decodes to the expected value", () => {
  // type=NUMBER, time=0x102, serial=0, value=7 (Int32LE @ 9); MakeCode layout.
  const bytes = new Uint8Array(RADIO_MAX_PACKET_SIZE);
  bytes[0] = RadioPacketType.Number;
  bytes[1] = 0x02;
  bytes[2] = 0x01;
  bytes[9] = 0x07;
  const decoded = decodeRadioFrame(bytes, 0, -10);
  assert.equal(decoded.value, 7);
  assert.equal(decoded.time, 0x102);
});

test("the receive ring delivers per-cursor, is non-consuming, and snaps forward on overflow", () => {
  const radio = new Radio();
  const numberMatch = (type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE) =>
    type === RadioPacketType.Number || type === RadioPacketType.Double;

  for (let i = 1; i <= 5; i++) {
    radio.deliver({
      type: RadioPacketType.Number,
      group: 0,
      value: i,
      name: "",
      text: "",
      bytes: EMPTY,
      rssi: 0,
      serial: 0,
      time: 0,
    });
  }
  // Depth 4: packet 1 was evicted; a cursor at 0 snaps to the oldest present (seq 2, value 2).
  const first = radio.nextAfter(0, numberMatch);
  assert.equal(first?.value, 2);
  assert.equal(first?.seq, 2);
  // Non-consuming: a second cursor at 0 still sees the same oldest present packet.
  assert.equal(radio.nextAfter(0, numberMatch)?.value, 2);
  // drainAfter returns the whole present batch since a cursor.
  assert.deepEqual(
    radio.drainAfter(0).map((p) => p.value),
    [2, 3, 4, 5]
  );
});

test("the receive ring filters by group", () => {
  const radio = new Radio();
  radio.setGroup(3);
  const stored = radio.deliver({
    type: RadioPacketType.Number,
    group: 1,
    value: 1,
    name: "",
    text: "",
    bytes: EMPTY,
    rssi: 0,
    serial: 0,
    time: 0,
  });
  assert.equal(stored, undefined); // dropped: wrong group
  assert.equal(radio.headSequence(), 0);
});
