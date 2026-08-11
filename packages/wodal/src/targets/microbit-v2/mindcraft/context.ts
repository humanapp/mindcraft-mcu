import type { ExecutionContext } from "@mindcraft-lang/core/app";
import type { HandleId } from "@mindcraft-lang/core/runtime";
import type { OperationEnd } from "../../../core/operation-end";
import { MicroBit } from "../microbit";

/**
 * One device operation ending, as the actuator that started it reports: which
 * call started it, how it ended, and whether the call waited for it.
 */
export interface DeviceOperationEnding {
  /** Handle the call that started the operation was dispatched on. */
  readonly handleId: HandleId;
  readonly end: OperationEnd;
  /** `true` when the call returned at dispatch and never waited for the operation. */
  readonly inBackground: boolean;
}

/** Called once per device operation ending, at the moment it ends. */
export type DeviceOperationObserver = (ending: DeviceOperationEnding) => void;

/** Runtime context data required by the WODAL Mindcraft module. */
export interface WodalMicroBitRuntimeContext {
  /** Simulated device used by WODAL host calls. */
  readonly microbit: MicroBit;

  /** Where the device's actuators report their operation endings; absent when nobody watches. */
  readonly operations?: DeviceOperationObserver;
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

/**
 * Reports one operation ending to whatever watches the context's device. A
 * no-op when nothing does.
 *
 * @param ctx - Mindcraft execution context the call runs in.
 * @param ending - How the operation ended and which call started it.
 */
export function reportDeviceOperationEnding(ctx: ExecutionContext, ending: DeviceOperationEnding): void {
  if (!isWodalMicroBitRuntimeContext(ctx.data)) {
    return;
  }
  ctx.data.operations?.(ending);
}
