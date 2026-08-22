import {
  CoreTypeIds,
  type CreateHostSensorOptions,
  type ExecutionContext,
  mkCallDef,
  mkNumberValue,
  type ReadonlyList,
  type Value,
} from "@wendoo/core/app";
import { getMicroBitContextDevice } from "../context";
import { MicroBitV2HostActions } from "../tile-ids";

const callDef = mkCallDef({ type: "bag", items: [] });

function exec(ctx: ExecutionContext, _args: ReadonlyList<Value>): Value {
  return mkNumberValue(getMicroBitContextDevice(ctx)?.display.getLightLevel() ?? 0);
}

/**
 * Host sensor: the ambient light level read off the LED matrix. Each tick it
 * polls the current level as a 0 (dark) to 255 (bright) number, which becomes
 * the WHEN result (truthy while above 0). A bare no-arg value sensor with no
 * per-call-site state. Inline, so its Number result composes with operators and
 * accessors (for example `[light level] [>] [50]`).
 */
export const lightLevelSensor: CreateHostSensorOptions = {
  ...MicroBitV2HostActions.LightLevel,
  callDef,
  fn: { exec },
  isAsync: false,
  outputType: CoreTypeIds.Number,
  inline: true,
  metadata: { label: "light level" },
};
