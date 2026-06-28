import {
  type AsyncHandle,
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractNumberValue,
  extractStringValue,
  formatF32,
  getSlotId,
  getWhenResult,
  isNilValue,
  mkCallDef,
  optional,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { getMicroBitContextDevice } from "../context";
import { SCROLL_DEFAULT_DELAY_MS, scrollDurationMs } from "../display-scroll";
import { hasModifier, Modifier } from "../modifiers";
import { Param } from "../parameters";
import { MicroBitV2HostActions } from "../tile-ids";

/** Text scrolled when the call omits the optional text argument. */
const DEFAULT_TEXT = "hello";

const callDef = mkCallDef(bag(optional(Param.text), optional(Modifier.immediately)));

const kTextSlotId = getSlotId(callDef, Param.text);
const kImmediatelySlotId = getSlotId(callDef, Modifier.immediately);

/** True when arg slot `slotId` carries a present (non-nil) value. */
function hasArg(args: ReadonlyList<Value>, slotId: number): boolean {
  const value = args.get(slotId);
  return value !== undefined && !isNilValue(value);
}

/**
 * Best-effort text for the rule's captured WHEN result: a number renders through
 * the binary32 formatter and a string passes through; any other value (a
 * boolean, nil, or container) yields undefined so the caller keeps its default.
 */
function whenResultText(ctx: ExecutionContext): string | undefined {
  const whenResult = getWhenResult(ctx);
  const num = extractNumberValue(whenResult);
  if (num !== undefined) {
    return formatF32(num);
  }
  return extractStringValue(whenResult);
}

function execDisplayScroll(ctx: ExecutionContext, args: ReadonlyList<Value>, handle: AsyncHandle): void {
  const text = hasArg(args, kTextSlotId)
    ? (extractStringValue(args.get(kTextSlotId)) ?? DEFAULT_TEXT)
    : (whenResultText(ctx) ?? DEFAULT_TEXT);
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    handle.resolve(VOID_VALUE);
    return;
  }
  if (hasModifier(args, kImmediatelySlotId)) {
    microbit.display.preempt();
  }
  const durationMs = scrollDurationMs(text.length, SCROLL_DEFAULT_DELAY_MS);
  microbit.display.scrollText(text, durationMs, ctx.time, () => handle.resolve(VOID_VALUE));
}

/**
 * Host actuator: scroll text across the simulated display. Asynchronous -- the
 * calling fiber awaits the returned handle and resumes when the scroll
 * animation completes. With the `immediately` modifier the current display lease
 * is preempted so the scroll starts at once; otherwise a scroll requested while
 * the display is busy is dropped.
 */
export default {
  ...MicroBitV2HostActions.DisplayScroll,
  callDef,
  fn: { exec: execDisplayScroll },
  isAsync: true,
  metadata: { label: "scroll text" },
} satisfies CreateHostActuatorOptions;
