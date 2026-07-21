import {
  CoreTypeIds,
  type CreateHostSensorOptions,
  type ExecutionContext,
  mkCallDef,
  mkNumberValue,
  type ReadonlyList,
  type Value,
} from "@mindcraft-lang/core/app";
import { getMicroBitContextDevice } from "../context";
import { MicroBitV2HostActions } from "../tile-ids";

const callDef = mkCallDef({ type: "bag", items: [] });

function exec(ctx: ExecutionContext, _args: ReadonlyList<Value>): Value {
  return mkNumberValue(getMicroBitContextDevice(ctx)?.thermometer.getTemperature() ?? 0);
}

/**
 * Host sensor: the die temperature in whole degrees Celsius. Each tick it polls
 * the current reading as a signed number, which becomes the WHEN result (truthy
 * while nonzero). A bare no-arg value sensor with no per-call-site state. Inline,
 * so its Number result composes with operators and accessors (for example
 * `[temperature] [>] [30]`).
 */
export const temperatureSensor: CreateHostSensorOptions = {
  ...MicroBitV2HostActions.Temperature,
  callDef,
  fn: { exec },
  isAsync: false,
  outputType: CoreTypeIds.Number,
  inline: true,
  metadata: { label: "temperature" },
};
