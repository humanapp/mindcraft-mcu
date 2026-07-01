import {
  BitSet,
  type BrainTileOutputDef,
  buildDescriptorOutputTiles,
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
  setSensorOutput,
  type Value,
} from "@mindcraft-lang/core/app";
import { type RADIO_RAW_PACKET_TYPE, RadioPacketType, type ReceivedRadioPacket } from "../../../../core/radio";
import { getMicroBitContextDevice } from "../context";
import { MicroBitV2HostActions } from "../tile-ids";

const emptyCallDef = mkCallDef({ type: "bag", items: [] });

/** Output name for the delivered packet value, typed per receive sensor (string or number). */
const VALUE_OUTPUT_NAME = "value";

/** Output name for the received signal strength (-dBm); shared by both receive sensors. */
const RSSI_OUTPUT_NAME = "rssi";

/** One output declaration on a receive sensor's descriptor. */
type ReceiveOutput = NonNullable<CreateHostSensorOptions["outputs"]>[number];

/** Per-callsite read cursor: the highest sequence number this callsite has delivered or passed. */
interface ReceiveCursor {
  cursor: number;
}

/** Selects which packet types a typed receive sensor delivers. */
type TypeMatcher = (type: RadioPacketType | typeof RADIO_RAW_PACKET_TYPE) => boolean;

/** Renders a matched packet as the sensor's result value. */
type PacketValue = (packet: ReceivedRadioPacket) => Value;

/** The output declarations a receive sensor exposes: its typed `value` plus the shared `signal strength`. */
function receiveOutputs(valueType: string): readonly ReceiveOutput[] {
  return [
    { name: VALUE_OUTPUT_NAME, type: valueType, label: "received value" },
    { name: RSSI_OUTPUT_NAME, type: CoreTypeIds.Number, label: "signal strength" },
  ];
}

function makeReceiveSensor(
  ids: HostActionIds,
  label: string,
  outputType: string,
  matches: TypeMatcher,
  renderValue: PacketValue,
  capabilities: BitSet,
  outputs: readonly ReceiveOutput[]
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
    // The rule is presence-gated, so the DO runs only when a packet arrived: a
    // write-on-present of each output is enough (no nil-at-top clear needed).
    const value = renderValue(packet);
    setSensorOutput(ctx, outputType, VALUE_OUTPUT_NAME, value);
    setSensorOutput(ctx, CoreTypeIds.Number, RSSI_OUTPUT_NAME, mkNumberValue(packet.rssi));
    return value;
  }

  return {
    ...ids,
    callDef: emptyCallDef,
    fn: { onPageEntered: clearCallSiteState, exec },
    isAsync: false,
    outputType,
    outputs,
    metadata: { label },
    capabilities,
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

const numberCapabilities = new BitSet().set(CoreCapabilityBits.PresenceGated);
const stringCapabilities = new BitSet().set(CoreCapabilityBits.PresenceGated);
const numberOutputs = receiveOutputs(CoreTypeIds.Number);
const stringOutputs = receiveOutputs(CoreTypeIds.String);

/**
 * Host sensor: the next received NUMBER / DOUBLE packet. Each think it delivers
 * the oldest still-unread bare-number packet of its type from the receive ring
 * (skipping other types, which the other typed sensors read), advancing its own
 * cursor by one. The delivered numeric value is the sensor's result; the packet's
 * value and signal strength are also written to the sensor's output tiles.
 */
export const radioReceiveNumberSensor = makeReceiveSensor(
  MicroBitV2HostActions.RadioReceiveNumber,
  "radio receive number",
  CoreTypeIds.Number,
  matchesNumber,
  numberValue,
  numberCapabilities,
  numberOutputs
);

/**
 * Host sensor: the next received STRING packet. Each think it delivers the
 * oldest still-unread string packet from the receive ring (skipping other
 * types), advancing its own cursor by one. The delivered string is the sensor's
 * result; the packet's value and signal strength are also written to the
 * sensor's output tiles.
 */
export const radioReceiveStringSensor = makeReceiveSensor(
  MicroBitV2HostActions.RadioReceiveString,
  "radio receive string",
  CoreTypeIds.String,
  matchesString,
  stringValue,
  stringCapabilities,
  stringOutputs
);

/** Keeps the first output tile of each tile id, dropping the shared-identity duplicates. */
function dedupeOutputTiles(tiles: readonly BrainTileOutputDef[]): readonly BrainTileOutputDef[] {
  const byId = new Map<string, BrainTileOutputDef>();
  for (const tile of tiles) {
    if (!byId.has(tile.tileId)) {
      byId.set(tile.tileId, tile);
    }
  }
  return [...byId.values()];
}

/**
 * Inline output value-tiles for the radio receive sensors: each sensor's typed
 * `value` plus the shared `signal strength` (`rssi`) output, deduped to one tile
 * by identity. Each tile is offered downstream only when a receive sensor listing
 * its {@link BrainTileOutputDef.outputKey} in `providedOutputs` is in the rule
 * hierarchy.
 */
export const radioReceiveOutputTiles: readonly BrainTileOutputDef[] = dedupeOutputTiles([
  ...buildDescriptorOutputTiles(numberOutputs),
  ...buildDescriptorOutputTiles(stringOutputs),
]);
