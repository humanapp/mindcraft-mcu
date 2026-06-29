import { toInt32, toUint8 } from "./numeric";

/**
 * MakeCode radio packet types, mirrored byte-for-byte from
 * `pxt-common-packages` `libs/radio`. The numeric value is the packet's first
 * on-air byte; a Mindcraft brain and a MakeCode program on the same group
 * interoperate because both encode and decode these identically.
 */
export enum RadioPacketType {
  /** An Int32LE numeric payload at offset 9. */
  Number = 0,

  /** An Int32LE numeric payload at offset 9 and a length-prefixed name at offset 13. */
  Value = 1,

  /** A length-prefixed UTF-8 string at offset 9. */
  String = 2,

  /** A length-prefixed byte buffer at offset 9 (payload up to 19 bytes). */
  Buffer = 3,

  /** A Float64LE numeric payload at offset 9. */
  Double = 4,

  /** A Float64LE numeric payload at offset 9 and a length-prefixed name at offset 17. */
  DoubleValue = 5,
}

/**
 * Type tag for a raw datagram carrying an arbitrary byte payload with no
 * MakeCode prefix. Sent by the Device-API raw escape hatch and surfaced on a
 * received packet so a consumer can tell raw traffic from framed traffic.
 */
export const RADIO_RAW_PACKET_TYPE = -1;

/** On-air datagram frame size in bytes, CODAL `RADIO_MAX_PACKET_SIZE`. */
export const RADIO_MAX_PACKET_SIZE = 32;

/** Fixed MakeCode prefix length: type (1) + system time (4) + serial (4). */
export const RADIO_PACKET_PREFIX_LENGTH = 9;

/** Largest typed payload, MakeCode `MAX_PAYLOAD_LENGTH` (frame minus prefix minus three trailing reserved bytes). */
export const RADIO_MAX_PAYLOAD_LENGTH = 20;

/** Largest value-pair name in bytes, MakeCode `MAX_FIELD_DOUBLE_NAME_LENGTH`. */
export const RADIO_MAX_FIELD_NAME_LENGTH = 8;

/** Offset of the VALUE packet's name length byte, MakeCode `VALUE_PACKET_NAME_LEN_OFFSET`. */
const VALUE_PACKET_NAME_LEN_OFFSET = 13;

/** Offset of the DOUBLE_VALUE packet's name length byte, MakeCode `DOUBLE_VALUE_PACKET_NAME_LEN_OFFSET`. */
const DOUBLE_VALUE_PACKET_NAME_LEN_OFFSET = 17;

/**
 * Receive ring depth, fixed at CODAL's protocol bound
 * `MICROBIT_RADIO_MAXIMUM_RX_BUFFERS`. The on-air protocol never buffers more
 * than this many undelivered packets, so the value is a hardware constant, not
 * a tunable capacity.
 */
export const RADIO_RX_RING_DEPTH = 4;

/** Default radio group, MakeCode/CODAL power-on default. */
export const RADIO_DEFAULT_GROUP = 0;

/** Default transmit power level (0-7), MakeCode/CODAL power-on default. */
export const RADIO_DEFAULT_TX_POWER = 6;

/** Default frequency band (0-83; channel at 2400 + band MHz), MakeCode/CODAL power-on default. */
export const RADIO_DEFAULT_FREQUENCY_BAND = 7;

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/**
 * A logical packet handed to {@link Radio.send}. The numeric, name, text, and
 * byte fields are interpreted by {@link type}; unused fields carry their empty
 * value (0, "", or an empty array).
 */
export interface RadioSendRecord {
  /** {@link RadioPacketType} member, or {@link RADIO_RAW_PACKET_TYPE} for a raw datagram. */
  readonly type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE;

  /** Group the packet is transmitted on. */
  readonly group: number;

  /** Numeric payload for NUMBER / VALUE / DOUBLE / DOUBLE_VALUE packets. */
  readonly value: number;

  /** Value-pair name for VALUE / DOUBLE_VALUE packets. */
  readonly name: string;

  /** String payload for STRING packets. */
  readonly text: string;

  /** Byte payload for BUFFER packets and raw datagrams. */
  readonly bytes: Uint8Array;
}

/**
 * A packet held in the receive ring. Carries the decoded typed payload plus the
 * per-packet metadata (sequence number, RSSI, sender serial, system time) a
 * receive callsite reads.
 */
export interface ReceivedRadioPacket {
  /** Monotonic arrival sequence number assigned by the ring (starts at 1). */
  readonly seq: number;

  /** {@link RadioPacketType} member, or {@link RADIO_RAW_PACKET_TYPE} for a raw datagram. */
  readonly type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE;

  /** Group the packet arrived on. */
  readonly group: number;

  /** Numeric payload, narrowed to f32; 0 when the type carries no number. */
  readonly value: number;

  /** Value-pair name; empty when the type carries no name. */
  readonly name: string;

  /** String payload; empty when the type carries no string. */
  readonly text: string;

  /** Buffer payload for BUFFER packets, or the whole datagram for raw packets; empty otherwise. */
  readonly bytes: Uint8Array;

  /** Received signal strength in -dBm (CODAL `getRSSI`). */
  readonly rssi: number;

  /** Sender device serial number, or 0 when the sender did not transmit it. */
  readonly serial: number;

  /** Sender running time in milliseconds at transmission. */
  readonly time: number;
}

/** An injected/decoded packet without its ring sequence number. */
export type IncomingRadioPacket = Omit<ReceivedRadioPacket, "seq">;

/**
 * Classifies a numeric payload as an integer (NUMBER / VALUE, Int32LE on the
 * wire) or a non-integer (DOUBLE / DOUBLE_VALUE, Float64LE), mirroring
 * MakeCode's `value === (value | 0)` predicate exactly. Both VMs apply this to
 * the same f32 value, so they pick the same wire type.
 */
export function radioNumberIsInteger(value: number): boolean {
  return value === (value | 0);
}

/** Truncates `text` to at most `maxBytes` UTF-8 bytes, dropping whole trailing characters (MakeCode `truncateString`). */
function truncateUtf8(text: string, maxBytes: number): Uint8Array {
  let bytes = UTF8_ENCODER.encode(text);
  let length = text.length;
  while (bytes.length > maxBytes) {
    length -= 1;
    bytes = UTF8_ENCODER.encode(text.slice(0, length));
  }
  return bytes;
}

function setInt32LE(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, toInt32(value), true);
}

function setFloat64LE(view: DataView, offset: number, value: number): void {
  view.setFloat64(offset, value, true);
}

function nameLengthOffset(type: RadioPacketType): number | undefined {
  switch (type) {
    case RadioPacketType.String:
      return RADIO_PACKET_PREFIX_LENGTH;
    case RadioPacketType.Value:
      return VALUE_PACKET_NAME_LEN_OFFSET;
    case RadioPacketType.DoubleValue:
      return DOUBLE_VALUE_PACKET_NAME_LEN_OFFSET;
    default:
      return undefined;
  }
}

function maxStringLength(type: RadioPacketType): number {
  return type === RadioPacketType.String ? RADIO_MAX_PAYLOAD_LENGTH - 1 : RADIO_MAX_FIELD_NAME_LENGTH;
}

/** Writes a length-prefixed UTF-8 string into `frame` at `offset` (length byte then bytes). */
function writeLengthPrefixedString(frame: Uint8Array, offset: number, text: string, maxBytes: number): void {
  const bytes = truncateUtf8(text, maxBytes);
  frame[offset] = bytes.length;
  frame.set(bytes, offset + 1);
}

/** Reads a length-prefixed UTF-8 string from `frame` at `offset`. */
function readLengthPrefixedString(frame: Uint8Array, offset: number): string {
  const length = frame[offset] ?? 0;
  return UTF8_DECODER.decode(frame.subarray(offset + 1, offset + 1 + length));
}

/**
 * Encodes a framed MakeCode packet to its 32-byte on-air frame. The numeric
 * payload follows {@link radioNumberIsInteger} (Int32LE or Float64LE); strings
 * and buffers are length-prefixed and truncated. `time` and `serial` populate
 * the prefix. The result is byte-for-byte the MakeCode layout.
 */
export function encodeRadioFrame(record: RadioSendRecord, time: number, serial: number): Uint8Array {
  const frame = new Uint8Array(RADIO_MAX_PACKET_SIZE);
  const view = new DataView(frame.buffer);
  const type = record.type as RadioPacketType;
  frame[0] = type;
  setInt32LE(view, 1, time);
  setInt32LE(view, 5, serial);
  switch (type) {
    case RadioPacketType.Number:
    case RadioPacketType.Value:
      setInt32LE(view, RADIO_PACKET_PREFIX_LENGTH, record.value);
      break;
    case RadioPacketType.Double:
    case RadioPacketType.DoubleValue:
      setFloat64LE(view, RADIO_PACKET_PREFIX_LENGTH, record.value);
      break;
    case RadioPacketType.String:
      writeLengthPrefixedString(frame, RADIO_PACKET_PREFIX_LENGTH, record.text, maxStringLength(type));
      break;
    case RadioPacketType.Buffer: {
      const length = Math.min(record.bytes.length, RADIO_MAX_PAYLOAD_LENGTH - 1);
      frame[RADIO_PACKET_PREFIX_LENGTH] = length;
      frame.set(record.bytes.subarray(0, length), RADIO_PACKET_PREFIX_LENGTH + 1);
      break;
    }
  }
  const nameOffset = nameLengthOffset(type);
  if (nameOffset !== undefined && (type === RadioPacketType.Value || type === RadioPacketType.DoubleValue)) {
    writeLengthPrefixedString(frame, nameOffset, record.name, RADIO_MAX_FIELD_NAME_LENGTH);
  }
  return frame;
}

/**
 * Decodes a MakeCode on-air frame to an incoming packet, narrowing numeric
 * payloads to f32. `rssi` is the received signal strength CODAL appends; the
 * group is supplied by the caller (CODAL filters by group before delivery).
 */
export function decodeRadioFrame(frame: Uint8Array, group: number, rssi: number): IncomingRadioPacket {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const type = frame[0] as RadioPacketType;
  const time = view.getInt32(1, true);
  const serial = view.getInt32(5, true);
  let value = 0;
  let name = "";
  let text = "";
  let bytes = new Uint8Array(0);
  switch (type) {
    case RadioPacketType.Number:
    case RadioPacketType.Value:
      value = Math.fround(view.getInt32(RADIO_PACKET_PREFIX_LENGTH, true));
      break;
    case RadioPacketType.Double:
    case RadioPacketType.DoubleValue:
      value = Math.fround(view.getFloat64(RADIO_PACKET_PREFIX_LENGTH, true));
      break;
    case RadioPacketType.String:
      text = readLengthPrefixedString(frame, RADIO_PACKET_PREFIX_LENGTH);
      break;
    case RadioPacketType.Buffer: {
      const length = frame[RADIO_PACKET_PREFIX_LENGTH] ?? 0;
      bytes = frame.slice(RADIO_PACKET_PREFIX_LENGTH + 1, RADIO_PACKET_PREFIX_LENGTH + 1 + length);
      break;
    }
  }
  if (type === RadioPacketType.Value || type === RadioPacketType.DoubleValue) {
    const nameOffset = nameLengthOffset(type);
    name = nameOffset !== undefined ? readLengthPrefixedString(frame, nameOffset) : "";
  }
  return { type, group, value, name, text, bytes, rssi, serial, time };
}

/**
 * CODAL-style 2.4 GHz packet radio model: group / power / band configuration, a
 * deterministic typed-packet send, and a bounded receive ring drained by the
 * brain. Send is observed at the device port; received packets are delivered
 * into the ring by the host loop and read by receive callsites on the next
 * think.
 */
export class Radio {
  private groupValue = RADIO_DEFAULT_GROUP;
  private txPower = RADIO_DEFAULT_TX_POWER;
  private band = RADIO_DEFAULT_FREQUENCY_BAND;
  private ring: ReceivedRadioPacket[] = [];
  private lastSeq = 0;
  private sendListener: ((record: RadioSendRecord) => void) | undefined;

  /** The current group (0-255). */
  get group(): number {
    return this.groupValue;
  }

  /**
   * Registers an observer invoked with each transmitted packet as it crosses the
   * port, or clears it with undefined. The simulator's virtual ether uses this to
   * route a send into other instances; it is not device state and survives
   * {@link reset}.
   *
   * @param listener - Observer for each send, or undefined to clear.
   */
  setSendListener(listener: ((record: RadioSendRecord) => void) | undefined): void {
    this.sendListener = listener;
  }

  /**
   * Sets the radio group; out-of-range values wrap to 8-bit storage.
   *
   * @param group - Group 0-255.
   */
  setGroup(group: number): void {
    this.groupValue = toUint8(group);
  }

  /**
   * Sets the transmit power level, clamped to 0-7.
   *
   * @param power - Power level 0-7.
   */
  setTransmitPower(power: number): void {
    this.txPower = Math.max(0, Math.min(7, Math.trunc(power)));
  }

  /**
   * Sets the frequency band, clamped to 0-83 (channel at 2400 + band MHz).
   *
   * @param band - Band 0-83.
   */
  setFrequencyBand(band: number): void {
    this.band = Math.max(0, Math.min(83, Math.trunc(band)));
  }

  /** The current transmit power level (0-7). */
  get transmitPower(): number {
    return this.txPower;
  }

  /** The current frequency band (0-83). */
  get frequencyBand(): number {
    return this.band;
  }

  /**
   * Transmits a typed packet on its group: notifies the send listener (when set)
   * and returns the record so a port tap can render it. On a single device the
   * packet has no observable ring effect.
   *
   * @param record - The typed packet to transmit.
   * @returns The transmitted record.
   */
  send(record: RadioSendRecord): RadioSendRecord {
    this.sendListener?.(record);
    return record;
  }

  /**
   * Delivers a received packet into the ring, assigning the next sequence
   * number. A packet whose group differs from the current group is dropped
   * (CODAL filters by group). Overflow past {@link RADIO_RX_RING_DEPTH}
   * overwrites the oldest packet.
   *
   * @param packet - The decoded incoming packet (without a sequence number).
   * @returns The stored packet with its sequence number, or undefined when dropped.
   */
  deliver(packet: IncomingRadioPacket): ReceivedRadioPacket | undefined {
    if (packet.group !== this.groupValue) {
      return undefined;
    }
    this.lastSeq += 1;
    const stored: ReceivedRadioPacket = { ...packet, seq: this.lastSeq };
    this.ring.push(stored);
    if (this.ring.length > RADIO_RX_RING_DEPTH) {
      this.ring.shift();
    }
    return stored;
  }

  /** The highest sequence number assigned so far (0 when nothing has arrived). A page-enter cursor arms to this. */
  headSequence(): number {
    return this.lastSeq;
  }

  /**
   * Returns the oldest packet still present whose sequence is greater than
   * `cursor` and whose type satisfies `matches`, or undefined when none. A
   * cursor pointing past evicted packets snaps forward to the oldest present
   * match.
   *
   * @param cursor - Highest sequence this callsite has already passed.
   * @param matches - Predicate selecting the packet types this callsite reads.
   */
  nextAfter(
    cursor: number,
    matches: (type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE) => boolean
  ): ReceivedRadioPacket | undefined {
    for (const packet of this.ring) {
      if (packet.seq > cursor && matches(packet.type)) {
        return packet;
      }
    }
    return undefined;
  }

  /**
   * Returns every packet still present whose sequence is greater than `since`,
   * in arrival order (the Device-API `receive(since)` batch). Stateless and
   * non-evicting: the caller passes its last-seen sequence and records the new
   * one from the batch. A `since` of 0 (the reserved "before any packet"
   * sentinel) delivers from the first packet (sequence 1).
   *
   * @param since - Exclusive sequence floor; packets with sequence > since are returned.
   */
  drainAfter(since: number): ReceivedRadioPacket[] {
    return this.ring.filter((packet) => packet.seq > since);
  }

  /** Resets configuration to power-on defaults and empties the receive ring. */
  reset(): void {
    this.groupValue = RADIO_DEFAULT_GROUP;
    this.txPower = RADIO_DEFAULT_TX_POWER;
    this.band = RADIO_DEFAULT_FREQUENCY_BAND;
    this.ring = [];
    this.lastSeq = 0;
  }
}
