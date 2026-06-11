import {
  bag,
  CoreTypeIds,
  type CreateHostSensorOptions,
  choice,
  clearCallSiteState,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNilValue,
  mkCallDef,
  optional,
  type ReadonlyList,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
} from "@mindcraft-lang/core/app";
import { getMicroBitContextDevice } from "../context";
import { Modifier } from "../modifiers";
import { MicroBitV2HostActions } from "../tile-ids";

const callDef = mkCallDef(bag(optional(choice(Modifier.pressed, Modifier.released))));

const kReleasedSlotId = getSlotId(callDef, Modifier.released);

function hasArg(args: ReadonlyList<Value>, slotId: number): boolean {
  const value = args.get(slotId);
  return value !== undefined && !isNilValue(value);
}

function execButtonA(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    return FALSE_VALUE;
  }
  const current = microbit.buttonA.isPressed() !== 0;
  const previous = getCallSiteState<boolean>(ctx);
  setCallSiteState(ctx, current);
  if (previous === undefined) {
    // First evaluation after a page enter seeds the baseline without an edge.
    return FALSE_VALUE;
  }
  const wantReleased = hasArg(args, kReleasedSlotId);
  const edge = wantReleased ? previous && !current : !previous && current;
  return edge ? TRUE_VALUE : FALSE_VALUE;
}

/**
 * Host sensor: edge-triggered button A. Reports the released-to-pressed edge by
 * default or with the `pressed` modifier, and the pressed-to-released edge with
 * the `released` modifier. The result is true only on the edge, not while the
 * button is held. Per-callsite state holds the previously observed button level
 * and is cleared on page enter so transitions that happened while the page was
 * inactive are not reported.
 */
export default {
  ...MicroBitV2HostActions.ButtonA,
  callDef,
  fn: { onPageEntered: clearCallSiteState, exec: execButtonA },
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
  metadata: { label: "button A" },
} satisfies CreateHostSensorOptions;
