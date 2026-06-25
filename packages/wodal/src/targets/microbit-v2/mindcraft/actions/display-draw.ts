import {
  type AsyncHandle,
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractNumberValue,
  getSlotId,
  isStructValue,
  mkCallDef,
  optional,
  type ReadonlyList,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { bufferByteAt, bufferLength, isBufferValue } from "@mindcraft-lang/core/runtime";
import { toNonNegativeInteger } from "../../../../core/numeric";
import { MICROBIT_LED_MATRIX_SIZE } from "../../constants";
import { builtInImageFrame, DEFAULT_BUILT_IN_IMAGE_NAME, getBuiltInImage } from "../built-in-images";
import { getMicroBitContextDevice } from "../context";
import { hasModifier, Modifier } from "../modifiers";
import { Param } from "../parameters";
import { ImageField, MicroBitV2HostActions } from "../tile-ids";

/** Milliseconds a draw holds the display when the call omits the optional duration (1 second). */
const DEFAULT_DURATION_MS = 1000;

/** The built-in image drawn when the call omits the optional image (the `happy` icon). */
const DEFAULT_IMAGE: ClippedFrame = builtInImageFrame(getBuiltInImage(DEFAULT_BUILT_IN_IMAGE_NAME));

const callDef = mkCallDef(bag(optional(Param.image), optional(Param.duration), optional(Modifier.immediately)));

const kImageSlotId = getSlotId(callDef, Param.image);
const kDurationSlotId = getSlotId(callDef, Param.duration);
const kImmediatelySlotId = getSlotId(callDef, Modifier.immediately);

/** A draw frame clipped to the display: packed brightness bytes plus its clipped size. */
interface ClippedFrame {
  /** Brightness bytes, row-major, length `width * height`. */
  readonly frame: number[];

  /** Clipped width in columns, at most the display width. */
  readonly width: number;

  /** Clipped height in rows, at most the display height. */
  readonly height: number;
}

/**
 * Clips an `Image` struct value to the display, returning the top-left region as
 * a packed brightness frame, or undefined when the value is not an `Image` (a
 * struct with numeric `width`/`height` and a `pixels` buffer). Pixels are read
 * from the buffer at the image's own row stride; cells past the buffer's end
 * read as brightness 0.
 */
function clipImage(value: Value): ClippedFrame | undefined {
  if (!isStructValue(value) || value.v === undefined) {
    return undefined;
  }
  const widthValue = extractNumberValue(value.v.get(ImageField.Width));
  const heightValue = extractNumberValue(value.v.get(ImageField.Height));
  const pixels = value.v.get(ImageField.Pixels);
  if (widthValue === undefined || heightValue === undefined || !isBufferValue(pixels)) {
    return undefined;
  }
  const imageWidth = toNonNegativeInteger(widthValue);
  const imageHeight = toNonNegativeInteger(heightValue);
  const width = Math.min(imageWidth, MICROBIT_LED_MATRIX_SIZE);
  const height = Math.min(imageHeight, MICROBIT_LED_MATRIX_SIZE);
  const pixelCount = bufferLength(pixels);
  const frame: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * imageWidth + col;
      frame.push(index < pixelCount ? (bufferByteAt(pixels, index) ?? 0) : 0);
    }
  }
  return { frame, width, height };
}

function execDrawImage(ctx: ExecutionContext, args: ReadonlyList<Value>, handle: AsyncHandle): void {
  const microbit = getMicroBitContextDevice(ctx);
  if (!microbit) {
    handle.resolve(VOID_VALUE);
    return;
  }
  if (hasModifier(args, kImmediatelySlotId)) {
    microbit.display.preempt();
  }
  const clipped = clipImage(args.get(kImageSlotId)) ?? DEFAULT_IMAGE;
  const durationSeconds = extractNumberValue(args.get(kDurationSlotId));
  // Convert the seconds argument to whole ms at f32 precision, matching the device.
  const durationMs =
    durationSeconds === undefined ? DEFAULT_DURATION_MS : toNonNegativeInteger(Math.fround(durationSeconds * 1000));
  microbit.display.drawImage(clipped.frame, clipped.width, clipped.height, durationMs, ctx.time, () =>
    handle.resolve(VOID_VALUE)
  );
}

/**
 * Host actuator: paste an `Image` to the simulated display top-left, clipped to
 * the 5x5 matrix. Two optional args: the anonymous `Image` (when absent a default
 * smiley is drawn) and the named hold duration in seconds (when absent 1
 * second). Asynchronous -- an explicit zero-duration draw resolves at dispatch
 * (fire-and-forget, no lease); a positive-duration draw (including the default 1
 * second) holds the display lease for the duration and resolves when it elapses,
 * with the awaiting fiber parked until then. With the `immediately` modifier the
 * current display lease is preempted so the draw runs at once; otherwise a draw
 * dispatched while the display is busy is silently dropped.
 */
export default {
  ...MicroBitV2HostActions.DrawImage,
  callDef,
  fn: { exec: execDrawImage },
  isAsync: true,
  metadata: { label: "draw image" },
} satisfies CreateHostActuatorOptions;
