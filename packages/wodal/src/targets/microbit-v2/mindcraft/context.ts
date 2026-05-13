import type { ExecutionContext } from "@mindcraft-lang/core/app";
import { MicroBit } from "../microbit";

/** Runtime context data required by the WODAL microbit-v2 Mindcraft module. */
export interface WodalMicroBitRuntimeContext {
  /** Simulated microbit device used by WODAL host calls. */
  readonly microbit: MicroBit;
}

/** Execution context with WODAL microbit-v2 runtime data attached. */
export interface WodalMicroBitExecutionContext extends ExecutionContext {
  /** WODAL microbit-v2 runtime data. */
  readonly data: WodalMicroBitRuntimeContext;
}

/**
 * Checks whether a value is WODAL microbit-v2 runtime context data.
 *
 * @param data - Candidate execution context data.
 * @returns True when the value contains a WODAL microbit device.
 */
export function isWodalMicroBitRuntimeContext(data: unknown): data is WodalMicroBitRuntimeContext {
  return data !== null && typeof data === "object" && (data as { microbit?: unknown }).microbit instanceof MicroBit;
}

/**
 * Reads the WODAL microbit device from a Mindcraft execution context.
 *
 * @param ctx - Mindcraft execution context.
 * @returns The attached microbit device, or undefined when no device is attached.
 */
export function getMicroBitContextDevice(ctx: ExecutionContext): MicroBit | undefined {
  return isWodalMicroBitRuntimeContext(ctx.data) ? ctx.data.microbit : undefined;
}
