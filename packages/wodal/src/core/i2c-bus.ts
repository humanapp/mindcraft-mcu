/** A write transaction recorded by an {@link I2CBus}. */
export interface I2CWriteRecord {
  /** 7-bit device address the bytes were addressed to. */
  readonly address: number;

  /** Bytes written, in transmission order; a fresh copy owned by the record. */
  readonly bytes: Uint8Array;
}

/**
 * Simulated I2C bus on the micro:bit edge connector (pins P19/P20). Models the
 * controller side of the bus the surface-2 `ctx.microbit.i2c` API drives:
 * `writeBuffer` calls {@link write} and `readBuffer` calls {@link read}, each one
 * complete START/STOP transaction. The bus owns no real hardware; it records
 * every write so a test can inspect the bytes a brain put on the bus, and it
 * serves reads from a per-address response a test injects with
 * {@link setReadResponse}.
 */
export class I2CBus {
  private readonly writes: I2CWriteRecord[] = [];
  private readonly readResponses = new Map<number, Uint8Array>();

  /**
   * Writes `data`'s bytes to the 7-bit `address` in one complete START/STOP
   * transaction and records the transaction. A zero-length `data` is a valid
   * address-only transaction (an empty record). Returns 0 (the simulated bus
   * always acknowledges); a real device port returns the CODAL status.
   *
   * @param address - 7-bit device address.
   * @param data - Bytes to transmit, in order.
   */
  write(address: number, data: Uint8Array): number {
    this.writes.push({ address, bytes: Uint8Array.from(data) });
    return 0;
  }

  /**
   * Reads `length` bytes from the 7-bit `address` in one complete START/STOP
   * transaction. An address with an injected response returns exactly `length`
   * bytes drawn from it (truncated when the response is longer, zero-padded when
   * shorter); an address with no injected response is a no-device read and
   * returns an empty array. The injected response is not consumed: repeated reads
   * of the same address return the same bytes until {@link setReadResponse}
   * replaces it.
   *
   * @param address - 7-bit device address.
   * @param length - Number of bytes to read.
   */
  read(address: number, length: number): Uint8Array {
    const response = this.readResponses.get(address);
    if (response === undefined) {
      return new Uint8Array(0);
    }
    const out = new Uint8Array(length);
    out.set(response.subarray(0, length));
    return out;
  }

  /**
   * Sets the bytes a {@link read} of the 7-bit `address` returns, replacing any
   * previous response. Until called for an address, a read of it is a no-device
   * read.
   *
   * @param address - 7-bit device address the response answers.
   * @param bytes - Bytes the address returns; copied into the bus.
   */
  setReadResponse(address: number, bytes: Uint8Array): void {
    this.readResponses.set(address, Uint8Array.from(bytes));
  }

  /** The recorded write transactions, in the order they were performed. */
  recordedWrites(): readonly I2CWriteRecord[] {
    return this.writes;
  }

  /** Clears all recorded writes and injected read responses, returning the bus to a fresh power-on state. */
  reset(): void {
    this.writes.length = 0;
    this.readResponses.clear();
  }
}
