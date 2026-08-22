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
  type HostActionIds,
  isNilValue,
  mkCallDef,
  optional,
  type ReadonlyList,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
} from "@wendoo-lang/core/app";
import type { MicroBit } from "../../microbit";
import { getMicroBitContextDevice } from "../context";
import { Modifier } from "../modifiers";
import { MicroBitV2HostActions } from "../tile-ids";

/**
 * Press-duration boundary in VM logical milliseconds: a release whose press
 * lasted at or above this derives a `long click`, a shorter press a `click`.
 * The think loop's ~16 ms granularity rounds it to whole ticks.
 */
export const LONG_CLICK_THRESHOLD_MS = 1000;

/**
 * Window in VM logical milliseconds within which a press following a click
 * derives a `double click`.
 */
export const DOUBLE_CLICK_WINDOW_MS = 500;

const callDef = mkCallDef(
  bag(
    optional(
      choice(
        Modifier.pressed,
        Modifier.released,
        Modifier.click,
        Modifier.doubleClick,
        Modifier.longClick,
        Modifier.held
      )
    )
  )
);

const kPressedSlotId = getSlotId(callDef, Modifier.pressed);
const kReleasedSlotId = getSlotId(callDef, Modifier.released);
const kClickSlotId = getSlotId(callDef, Modifier.click);
const kDoubleClickSlotId = getSlotId(callDef, Modifier.doubleClick);
const kLongClickSlotId = getSlotId(callDef, Modifier.longClick);
const kHeldSlotId = getSlotId(callDef, Modifier.held);

/** Reads the polled press level that defines a button sensor's input. */
type ButtonLevelReader = (microbit: MicroBit) => boolean;

/**
 * Per-call-site derivation state. Seeded on the first evaluation after a page
 * enter so transitions while the page was inactive are not reported. Times are
 * VM logical tick time in milliseconds.
 */
interface ButtonSensorState {
  /** Press level observed on the previous evaluation. */
  prevPressed: boolean;

  /** Tick time the current or last press began. */
  pressStartMs: number;

  /** Tick time the last click fired; meaningful only when `hasPendingClick`. */
  lastClickMs: number;

  /** Whether a click is still eligible to begin a double-click. */
  hasPendingClick: boolean;
}

/** Derived events for one evaluation; at most one edge event occurs per tick. */
interface ButtonEvents {
  pressed: boolean;
  released: boolean;
  click: boolean;
  doubleClick: boolean;
  longClick: boolean;
  held: boolean;
}

function hasArg(args: ReadonlyList<Value>, slotId: number): boolean {
  const value = args.at(slotId);
  return value !== undefined && !isNilValue(value);
}

/** Selects the event the present modifier reports; an absent modifier reports a press. */
function selectEvent(args: ReadonlyList<Value>, events: ButtonEvents): boolean {
  if (hasArg(args, kPressedSlotId)) return events.pressed;
  if (hasArg(args, kReleasedSlotId)) return events.released;
  if (hasArg(args, kClickSlotId)) return events.click;
  if (hasArg(args, kDoubleClickSlotId)) return events.doubleClick;
  if (hasArg(args, kLongClickSlotId)) return events.longClick;
  if (hasArg(args, kHeldSlotId)) return events.held;
  return events.pressed;
}

/**
 * Advances `state` for the current `pressed` level at time `now` and returns
 * the events derived this tick.
 */
function deriveEvents(state: ButtonSensorState, pressed: boolean, now: number): ButtonEvents {
  const events: ButtonEvents = {
    pressed: false,
    released: false,
    click: false,
    doubleClick: false,
    longClick: false,
    held: pressed,
  };
  const pressEdge = !state.prevPressed && pressed;
  const releaseEdge = state.prevPressed && !pressed;
  if (pressEdge) {
    events.pressed = true;
    if (state.hasPendingClick && now - state.lastClickMs <= DOUBLE_CLICK_WINDOW_MS) {
      events.doubleClick = true;
      state.hasPendingClick = false;
    }
    state.pressStartMs = now;
  } else if (releaseEdge) {
    events.released = true;
    if (now - state.pressStartMs >= LONG_CLICK_THRESHOLD_MS) {
      events.longClick = true;
    } else {
      events.click = true;
      state.lastClickMs = now;
      state.hasPendingClick = true;
    }
  }
  state.prevPressed = pressed;
  return events;
}

function makeButtonSensor(ids: HostActionIds, label: string, readLevel: ButtonLevelReader): CreateHostSensorOptions {
  function exec(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
    const microbit = getMicroBitContextDevice(ctx);
    if (!microbit) {
      return FALSE_VALUE;
    }
    const pressed = readLevel(microbit);
    const now = ctx.time;
    const previous = getCallSiteState<ButtonSensorState>(ctx);
    if (previous === undefined) {
      // First evaluation after a page enter seeds the baseline without an edge.
      setCallSiteState(ctx, {
        prevPressed: pressed,
        pressStartMs: now,
        lastClickMs: 0,
        hasPendingClick: false,
      } satisfies ButtonSensorState);
      return FALSE_VALUE;
    }
    const events = deriveEvents(previous, pressed, now);
    setCallSiteState(ctx, previous);
    return selectEvent(args, events) ? TRUE_VALUE : FALSE_VALUE;
  }

  return {
    ...ids,
    callDef,
    fn: { onPageEntered: clearCallSiteState, exec },
    isAsync: false,
    outputType: CoreTypeIds.Boolean,
    metadata: { label, language: { frame: "event", bare: "pressed" } },
  } satisfies CreateHostSensorOptions;
}

/**
 * Host sensor: button A. Polls the button A press level each tick and derives
 * one button event from the polled stream, selected by the tile's optional
 * modifier (default `pressed`). The result is true only on the tick its event
 * occurs; `held` is true on every pressed tick. Per-call-site state holds the
 * derivation state and is cleared on page enter.
 */
export const buttonASensor = makeButtonSensor(
  MicroBitV2HostActions.ButtonA,
  "button A",
  (microbit) => microbit.buttonA.isPressed() !== 0
);

/**
 * Host sensor: button B. Polls the button B press level each tick and derives
 * one button event from the polled stream, selected by the tile's optional
 * modifier (default `pressed`). The result is true only on the tick its event
 * occurs; `held` is true on every pressed tick. Per-call-site state holds the
 * derivation state and is cleared on page enter.
 */
export const buttonBSensor = makeButtonSensor(
  MicroBitV2HostActions.ButtonB,
  "button B",
  (microbit) => microbit.buttonB.isPressed() !== 0
);

/**
 * Host sensor: buttons A and B together. The polled press level is true only
 * while both buttons are pressed; events derive from that combined level.
 */
export const buttonABSensor = makeButtonSensor(
  MicroBitV2HostActions.ButtonAB,
  "button A+B",
  (microbit) => microbit.buttonA.isPressed() !== 0 && microbit.buttonB.isPressed() !== 0
);

/**
 * Host sensor: the capacitive touch logo. Treated like a button; the polled
 * touch level drives the same derivation with a hard-coded touch threshold.
 */
export const buttonLogoSensor = makeButtonSensor(
  MicroBitV2HostActions.ButtonLogo,
  "logo",
  (microbit) => microbit.logo.isPressed() !== 0
);
