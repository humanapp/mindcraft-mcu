import {
  bag,
  CoreTypeIds,
  type CreateHostSensorOptions,
  choice,
  type ExecutionContext,
  FALSE_VALUE,
  getSlotId,
  isNilValue,
  mkCallDef,
  optional,
  type ReadonlyList,
  TRUE_VALUE,
  type Value,
} from "@mindcraft-lang/core/app";
import { AccelerometerGesture } from "../../../../core/accelerometer";
import { getMicroBitContextDevice } from "../context";
import { Modifier } from "../modifiers";
import { MicroBitV2HostActions } from "../tile-ids";

const callDef = mkCallDef(
  bag(
    optional(
      choice(
        Modifier.shake,
        Modifier.tiltUp,
        Modifier.tiltDown,
        Modifier.tiltLeft,
        Modifier.tiltRight,
        Modifier.faceUp,
        Modifier.faceDown,
        Modifier.freefall
      )
    )
  )
);

const kShakeSlotId = getSlotId(callDef, Modifier.shake);
const kTiltUpSlotId = getSlotId(callDef, Modifier.tiltUp);
const kTiltDownSlotId = getSlotId(callDef, Modifier.tiltDown);
const kTiltLeftSlotId = getSlotId(callDef, Modifier.tiltLeft);
const kTiltRightSlotId = getSlotId(callDef, Modifier.tiltRight);
const kFaceUpSlotId = getSlotId(callDef, Modifier.faceUp);
const kFaceDownSlotId = getSlotId(callDef, Modifier.faceDown);
const kFreefallSlotId = getSlotId(callDef, Modifier.freefall);

function hasArg(args: ReadonlyList<Value>, slotId: number): boolean {
  const value = args.get(slotId);
  return value !== undefined && !isNilValue(value);
}

/** The gesture code the present modifier matches; an absent modifier matches shake. */
function selectGestureCode(args: ReadonlyList<Value>): AccelerometerGesture {
  if (hasArg(args, kShakeSlotId)) return AccelerometerGesture.Shake;
  if (hasArg(args, kTiltUpSlotId)) return AccelerometerGesture.TiltUp;
  if (hasArg(args, kTiltDownSlotId)) return AccelerometerGesture.TiltDown;
  if (hasArg(args, kTiltLeftSlotId)) return AccelerometerGesture.TiltLeft;
  if (hasArg(args, kTiltRightSlotId)) return AccelerometerGesture.TiltRight;
  if (hasArg(args, kFaceUpSlotId)) return AccelerometerGesture.FaceUp;
  if (hasArg(args, kFaceDownSlotId)) return AccelerometerGesture.FaceDown;
  if (hasArg(args, kFreefallSlotId)) return AccelerometerGesture.Freefall;
  return AccelerometerGesture.Shake;
}

function exec(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    return FALSE_VALUE;
  }
  return microbit.accelerometer.getGesture() === selectGestureCode(args) ? TRUE_VALUE : FALSE_VALUE;
}

/**
 * Host sensor: an accelerometer gesture. Each tick it polls the current gesture
 * code and is true while that equals the gesture its optional modifier selects
 * (default `shake`): a pure level compare with no per-call-site state. The eight
 * modifiers map to shake, the four tilts, the two faces, and freefall.
 */
export const gestureSensor: CreateHostSensorOptions = {
  ...MicroBitV2HostActions.Gesture,
  callDef,
  fn: { exec },
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
  metadata: { label: "gesture", language: { frame: "event" } },
};
