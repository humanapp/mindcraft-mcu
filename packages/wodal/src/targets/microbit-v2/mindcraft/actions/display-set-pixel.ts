import {
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractNumberValue,
  getSlotId,
  mkCallDef,
  optional,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { getMicroBitContextDevice } from "../context";
import { Param } from "../parameters";
import { MicroBitV2HostActions } from "../tile-ids";

const DEFAULT_X = 0;
const DEFAULT_Y = 0;
const DEFAULT_BRIGHTNESS = 255;

const callDef = mkCallDef(bag(optional(Param.x), optional(Param.y), optional(Param.brightness)));

const kXSlotId = getSlotId(callDef, Param.x);
const kYSlotId = getSlotId(callDef, Param.y);
const kBrightnessSlotId = getSlotId(callDef, Param.brightness);

function execDisplaySetPixel(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    return VOID_VALUE;
  }
  const x = extractNumberValue(args.get(kXSlotId)) ?? DEFAULT_X;
  const y = extractNumberValue(args.get(kYSlotId)) ?? DEFAULT_Y;
  const brightness = extractNumberValue(args.get(kBrightnessSlotId)) ?? DEFAULT_BRIGHTNESS;
  microbit.display.setPixelValue(x, y, brightness);
  return VOID_VALUE;
}

/** Host actuator: set one LED pixel brightness on the simulated display. */
export default {
  ...MicroBitV2HostActions.DisplaySetPixel,
  callDef,
  fn: { exec: execDisplaySetPixel },
  isAsync: false,
  metadata: { label: "set pixel" },
} satisfies CreateHostActuatorOptions;
