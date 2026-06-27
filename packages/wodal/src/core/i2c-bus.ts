/** A write transaction recorded by an {@link I2CBus}. */
export interface I2CWriteRecord {
  /** 7-bit device address the bytes were addressed to. */
  readonly address: number;

  /** Bytes written, in transmission order; a fresh copy owned by the record. */
  readonly bytes: Uint8Array;
}

/**
 * Simulated I2C bus on the micro:bit edge connector (pins P19/P20). Models the
 * controller side of the bus the surface-2 `ctx.microbit.i2c` API drives: a
 * `writeBuffer` host-function calls {@link write}, which performs one complete
 * START/STOP transaction. The bus owns no real hardware; it records every write
 * so a test can inspect the exact bytes a brain put on the bus.
 */
export class I2CBus {
  private readonly writes: I2CWriteRecord[] = [];

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

  /** The recorded write transactions, in the order they were performed. */
  recordedWrites(): readonly I2CWriteRecord[] {
    return this.writes;
  }

  /** Clears all recorded writes, returning the bus to a fresh power-on state. */
  reset(): void {
    this.writes.length = 0;
  }
}
