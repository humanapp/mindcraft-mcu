import {
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  mkCallDef,
  type Value,
  VOID_VALUE,
} from "@wendoo-lang/core/app";
import { getMicroBitContextDevice } from "../context";
import { MicroBitV2HostActions } from "../tile-ids";

const callDef = mkCallDef(bag());

function execDisplayClear(ctx: ExecutionContext): Value {
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    return VOID_VALUE;
  }
  microbit.display.clear();
  return VOID_VALUE;
}

/** Host actuator: blank the 5x5 display, cancelling any held display lease. */
export default {
  ...MicroBitV2HostActions.DisplayClear,
  callDef,
  fn: { exec: execDisplayClear },
  isAsync: false,
  metadata: { label: "clear display" },
} satisfies CreateHostActuatorOptions;
