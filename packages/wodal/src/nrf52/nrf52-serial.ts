import { toUint8 } from "../core/numeric";

/** Snapshot of simulated serial buffers. */
export interface NRF52SerialSnapshot {
  /** Bytes written by the device and waiting for an adapter to consume. */
  readonly tx: readonly number[];

  /** Bytes injected by an adapter and waiting for device code to read. */
  readonly rx: readonly number[];
}

/** Simulated NRF52 serial byte stream. */
export class NRF52Serial {
  private readonly tx: number[] = [];
  private readonly rx: number[] = [];

  /**
   * Writes UTF-8-compatible byte values to the transmit buffer.
   *
   * @param data - String or byte data to send.
   * @returns Number of bytes written.
   */
  send(data: string | Iterable<number>): number {
    const bytes = typeof data === "string" ? Array.from(data, (char) => char.charCodeAt(0)) : Array.from(data);
    for (const byte of bytes) {
      this.tx.push(toUint8(byte));
    }
    return bytes.length;
  }

  /**
   * Injects received bytes into the device-facing read buffer.
   *
   * @param data - Bytes received from an external adapter.
   * @returns Number of bytes queued.
   */
  receive(data: Iterable<number>): number {
    const bytes = Array.from(data);
    for (const byte of bytes) {
      this.rx.push(toUint8(byte));
    }
    return bytes.length;
  }

  /** Reads one received byte, or `undefined` when no data is available. */
  readByte(): number | undefined {
    return this.rx.shift();
  }

  /** Drains bytes written by device code. */
  drainTx(): number[] {
    return this.tx.splice(0);
  }

  /** Clears both serial buffers. */
  clear(): void {
    this.tx.length = 0;
    this.rx.length = 0;
  }

  /** Returns a serializable view of serial buffers. */
  snapshot(): NRF52SerialSnapshot {
    return {
      tx: this.tx.slice(),
      rx: this.rx.slice(),
    };
  }
}
