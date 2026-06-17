import {
  type AsyncHandle,
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractStringValue,
  getSlotId,
  mkCallDef,
  optional,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { getMicroBitContextDevice } from "../context";
import { SCROLL_DEFAULT_DELAY_MS, scrollDurationMs } from "../display-scroll";
import { Param } from "../parameters";
import { MicroBitV2HostActions } from "../tile-ids";

/** Text scrolled when the call omits the optional text argument. */
const DEFAULT_TEXT = "hello";

const callDef = mkCallDef(bag(optional(Param.text)));

const kTextSlotId = getSlotId(callDef, Param.text);

function execDisplayScroll(ctx: ExecutionContext, args: ReadonlyList<Value>, handle: AsyncHandle): void {
  const text = extractStringValue(args.get(kTextSlotId)) ?? DEFAULT_TEXT;
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    handle.resolve(VOID_VALUE);
    return;
  }
  const durationMs = scrollDurationMs(text.length, SCROLL_DEFAULT_DELAY_MS);
  microbit.display.scrollText(text, durationMs, ctx.time, () => handle.resolve(VOID_VALUE));
}

/**
 * Host actuator: scroll text across the simulated display. Asynchronous -- the
 * calling fiber awaits the returned handle and resumes when the scroll
 * animation completes.
 */
export default {
  ...MicroBitV2HostActions.DisplayScroll,
  callDef,
  fn: { exec: execDisplayScroll },
  isAsync: true,
  metadata: { label: "scroll text" },
} satisfies CreateHostActuatorOptions;
