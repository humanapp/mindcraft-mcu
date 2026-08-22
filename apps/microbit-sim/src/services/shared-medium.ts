import type { IncomingRadioPacket, RadioSendRecord } from "@wendoo/wodal/targets/microbit-v2";

/**
 * Signal strength in -dBm stamped on every packet delivered through the
 * simulated ether. The simulator has no physical signal, so a fixed strong
 * value stands in for the RSSI a received packet carries.
 */
const SIMULATED_RSSI = -42;

/**
 * A registered radio endpoint: its current group and the device inject path that
 * delivers a received packet into its receive ring. The WODAL `Radio` satisfies
 * this structurally.
 */
export interface RadioEndpoint {
  /** The endpoint's current radio group (0-255). */
  readonly group: number;

  /** Delivers a received packet into the endpoint's receive ring. */
  deliver(packet: IncomingRadioPacket): void;
}

/**
 * App-owned shared medium for simulator instances. Each instance registers its
 * radio endpoint on create and unregisters on destroy. A send routes through
 * {@link transmit} to every other same-group instance's inject path.
 */
export class SharedMedium {
  private readonly endpoints = new Map<string, RadioEndpoint>();

  /** Registers an instance's radio endpoint into the medium. */
  register(instanceId: string, endpoint: RadioEndpoint): void {
    this.endpoints.set(instanceId, endpoint);
  }

  /** Removes an instance from the medium. */
  unregister(instanceId: string): void {
    this.endpoints.delete(instanceId);
  }

  /** Whether an instance is currently registered. */
  has(instanceId: string): boolean {
    return this.endpoints.has(instanceId);
  }

  /** Number of registered instances. */
  size(): number {
    return this.endpoints.size;
  }

  /**
   * Delivers `packet` (sent by `fromInstanceId` on `group`) into every other
   * registered instance whose current radio group equals `group`. The sender is
   * never delivered its own packet.
   *
   * @param fromInstanceId - The sending instance's id.
   * @param group - The sender's radio group at send time.
   * @param packet - The transmitted packet.
   */
  transmit(fromInstanceId: string, group: number, packet: RadioSendRecord): void {
    for (const [instanceId, endpoint] of this.endpoints) {
      if (instanceId === fromInstanceId || endpoint.group !== group) {
        continue;
      }
      endpoint.deliver(toIncoming(packet));
    }
  }
}

/** Builds the received-packet form of a transmitted packet, stamping the simulated metadata. */
function toIncoming(packet: RadioSendRecord): IncomingRadioPacket {
  return {
    type: packet.type,
    group: packet.group,
    value: packet.value,
    name: packet.name,
    text: packet.text,
    bytes: packet.bytes,
    rssi: SIMULATED_RSSI,
    serial: 0,
    time: 0,
  };
}
