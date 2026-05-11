import { clampUint32, toNonNegativeInteger, toUint32 } from "../core/numeric";

/** Snapshot of simulated flash memory. */
export interface NRF52FlashSnapshot {
  /** Flash page size in bytes. */
  readonly pageSize: number;

  /** Total flash size in bytes. */
  readonly size: number;
}

/** Simulated byte-addressable flash storage. */
export class NRF52FlashManager {
  private readonly storage: Uint8Array;
  private readonly size: number;
  private readonly pageSize: number;

  /**
   * Creates flash storage.
   *
   * @param size - Total flash size in bytes.
   * @param pageSize - Erase page size in bytes.
   */
  constructor(size = 64 * 1024, pageSize = 1024) {
    this.size = Math.max(1, clampUint32(size));
    this.pageSize = Math.max(1, clampUint32(pageSize));
    this.storage = new Uint8Array(this.size);
    this.storage.fill(0xff);
  }

  /** Returns the total flash size in bytes. */
  getFlashSize(): number {
    return this.size;
  }

  /** Returns the erase page size in bytes. */
  getPageSize(): number {
    return this.pageSize;
  }

  /**
   * Reads bytes from flash.
   *
   * @param address - Zero-based byte address.
   * @param length - Number of bytes to read.
   */
  read(address: number, length: number): Uint8Array {
    const start = this.clampAddress(address);
    const end = this.clampAddress(start + toNonNegativeInteger(length));
    return this.storage.slice(start, end);
  }

  /**
   * Writes bytes to flash.
   *
   * @param address - Zero-based byte address.
   * @param data - Bytes to write.
   * @returns Number of bytes written.
   */
  write(address: number, data: Uint8Array): number {
    const start = this.clampAddress(address);
    const length = Math.min(data.length, this.size - start);
    this.storage.set(data.slice(0, length), start);
    return length;
  }

  /**
   * Erases one flash page to 0xff.
   *
   * @param page - Zero-based page index.
   */
  erasePage(page: number): void {
    const start = toUint32(page) * this.pageSize;
    const end = Math.min(this.size, start + this.pageSize);
    if (start >= this.size) {
      return;
    }
    this.storage.fill(0xff, start, end);
  }

  /** Returns flash dimensions. */
  snapshot(): NRF52FlashSnapshot {
    return {
      pageSize: this.pageSize,
      size: this.size,
    };
  }

  private clampAddress(address: number): number {
    return Math.min(this.size, toUint32(address));
  }
}
