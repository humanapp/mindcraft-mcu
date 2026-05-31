import type { ExecutionContext } from "@mindcraft-lang/core/app";
import { MicroBit } from "../microbit";

/** Runtime context data required by the WODAL Mindcraft module. */
export interface WodalMicroBitRuntimeContext {
  /** Simulated device used by WODAL host calls. */
  readonly microbit: MicroBit;
}

/**
 * Checks whether a value is WODAL runtime context data.
 *
 * @param data - Candidate execution context data.
 * @returns True when the value contains a WODAL device.
 */
export function isWodalMicroBitRuntimeContext(data: unknown): data is WodalMicroBitRuntimeContext {
  return data !== null && typeof data === "object" && (data as { microbit?: unknown }).microbit instanceof MicroBit;
}

/**
 * Reads the WODAL device from a Mindcraft execution context.
 *
 * @param ctx - Mindcraft execution context.
 * @returns The attached device, or undefined when no device is attached.
 */
export function getMicroBitContextDevice(ctx: ExecutionContext): MicroBit | undefined {
  return isWodalMicroBitRuntimeContext(ctx.data) ? ctx.data.microbit : undefined;
}
