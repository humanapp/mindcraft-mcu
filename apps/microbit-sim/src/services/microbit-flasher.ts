/**
 * WebUSB flashing of a patched firmware hex to a micro:bit, via the micro:bit
 * connection library. The user pairs a device once (the browser permission
 * prompt); the connection is held for the session and reused by the per-brain
 * flash links, with the library's reconnect handling keeping the paired state in
 * sync.
 *
 * Flashing uses the library's partial flash: only the changed flash pages are
 * written (the program region), leaving the SoftDevice and firmware intact, with
 * a correct full-flash fallback for a bare board. WebUSB is Chromium-only; on
 * browsers without it ({@link isWebUsbSupported} is false) the per-brain download
 * link is the fallback.
 */

import { ConnectionStatus, createWebUSBConnection, type MicrobitWebUSBConnection } from "@microbit/microbit-connection";

/** True when this browser exposes the WebUSB API the flash path needs. */
export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

/**
 * Holds the paired micro:bit for the session and flashes patched firmware hex to
 * it. A single instance backs the UI; subscribe with {@link subscribe} and read
 * {@link isPaired} for `useSyncExternalStore`.
 */
export class MicrobitFlasher {
  private connection: MicrobitWebUSBConnection | undefined;
  private readonly listeners = new Set<() => void>();

  /** Subscribes to connection-status changes for `useSyncExternalStore`. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Whether a device is currently connected and ready to flash. */
  isPaired = (): boolean => this.connection?.status === ConnectionStatus.CONNECTED;

  /**
   * Prompts the user to select and connect a micro:bit. Rejects if the user
   * dismisses the chooser or the device fails to connect. The connection is held
   * for the session; the library tracks status and reconnects on disruption.
   */
  async pair(): Promise<void> {
    if (!this.connection) {
      const connection = createWebUSBConnection();
      await connection.initialize();
      connection.addEventListener("status", this.notify);
      this.connection = connection;
    }
    const status = await this.connection.connect();
    if (status !== ConnectionStatus.CONNECTED) {
      throw new Error(`micro:bit not connected (${status})`);
    }
    this.notify();
  }

  /**
   * Flashes `firmwareHex` (patched Intel HEX) to the paired device with a partial
   * flash. `onProgress` receives a 0..100 percentage (and 100 on completion).
   * Throws if no device is paired or the transfer fails.
   */
  async flashHex(firmwareHex: string, onProgress?: (percentage: number) => void): Promise<void> {
    const connection = this.connection;
    if (!connection) {
      throw new Error("No micro:bit paired");
    }
    await connection.flash(async () => firmwareHex, {
      partial: true,
      progress: (percentage: number | undefined) => onProgress?.(percentage ?? 100),
    });
  }

  private notify = (): void => {
    for (const listener of this.listeners) {
      listener();
    }
  };
}

/** The session-wide flasher backing the per-brain flash links. */
export const microbitFlasher = new MicrobitFlasher();
