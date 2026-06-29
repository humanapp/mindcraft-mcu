import {
  BitSet,
  CoreCapabilityBits,
  CoreTypeIds,
  type CreateHostSensorOptions,
  clearCallSiteState,
  type ExecutionContext,
  getCallSiteState,
  type HostActionIds,
  mkCallDef,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  type ReadonlyList,
  setCallSiteState,
  type Value,
} from "@mindcraft-lang/core/app";
import { type RADIO_RAW_PACKET_TYPE, RadioPacketType, type ReceivedRadioPacket } from "../../../../core/radio";
import { getMicroBitContextDevice } from "../context";
import { MicroBitV2HostActions } from "../tile-ids";

const emptyCallDef = mkCallDef({ type: "bag", items: [] });

/** Per-callsite read cursor: the highest sequence number this callsite has delivered or passed. */
interface ReceiveCursor {
  cursor: number;
}

/** Selects which packet types a typed receive sensor delivers. */
type TypeMatcher = (type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE) => boolean;

/** Renders a matched packet as the sensor's result value. */
type PacketValue = (packet: ReceivedRadioPacket) => Value;

function makeReceiveSensor(
  ids: HostActionIds,
  label: string,
  outputType: string,
  matches: TypeMatcher,
  renderValue: PacketValue
): CreateHostSensorOptions {
  function exec(ctx: ExecutionContext, _args: ReadonlyList<Value>): Value {
    const microbit = getMicroBitContextDevice(ctx);
    if (!microbit) {
      return NIL_VALUE;
    }
    const radio = microbit.radio;
    const previous = getCallSiteState<ReceiveCursor>(ctx);
    if (previous === undefined) {
      // First evaluation after a page enter arms the cursor to the ring head so
      // only packets that arrive after the page is active are delivered.
      setCallSiteState(ctx, { cursor: radio.headSequence() } satisfies ReceiveCursor);
      return NIL_VALUE;
    }
    const packet = radio.nextAfter(previous.cursor, matches);
    if (packet === undefined) {
      return NIL_VALUE;
    }
    previous.cursor = packet.seq;
    setCallSiteState(ctx, previous);
    return renderValue(packet);
  }

  return {
    ...ids,
    callDef: emptyCallDef,
    fn: { onPageEntered: clearCallSiteState, exec },
    isAsync: false,
    outputType,
    metadata: { label },
    capabilities: new BitSet().set(CoreCapabilityBits.PresenceGated),
  } satisfies CreateHostSensorOptions;
}

function numberValue(packet: ReceivedRadioPacket): Value {
  return mkNumberValue(packet.value);
}

function stringValue(packet: ReceivedRadioPacket): Value {
  return mkStringValue(packet.text);
}

function matchesNumber(type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE): boolean {
  return type === RadioPacketType.Number || type === RadioPacketType.Double;
}

function matchesString(type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE): boolean {
  return type === RadioPacketType.String;
}

/**
 * Host sensor: the next received NUMBER / DOUBLE packet. Each think it delivers
 * the oldest still-unread bare-number packet of its type from the receive ring
 * (skipping other types, which the other typed sensors read), advancing its own
 * cursor by one. The delivered numeric value is the sensor's result.
 */
export const radioReceiveNumberSensor = makeReceiveSensor(
  MicroBitV2HostActions.RadioReceiveNumber,
  "radio receive number",
  CoreTypeIds.Number,
  matchesNumber,
  numberValue
);

/**
 * Host sensor: the next received STRING packet. Each think it delivers the
 * oldest still-unread string packet from the receive ring (skipping other
 * types), advancing its own cursor by one. The delivered string is the sensor's
 * result.
 */
export const radioReceiveStringSensor = makeReceiveSensor(
  MicroBitV2HostActions.RadioReceiveString,
  "radio receive string",
  CoreTypeIds.String,
  matchesString,
  stringValue
);
