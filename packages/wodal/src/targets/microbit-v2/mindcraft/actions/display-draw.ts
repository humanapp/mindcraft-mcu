import {
  type AsyncHandle,
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  extractNumberValue,
  getSlotId,
  isListValue,
  isStructValue,
  mkCallDef,
  optional,
  type ReadonlyList,
  repeated,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { bufferByteAt, bufferLength, isBufferValue } from "@mindcraft-lang/core/runtime";
import { toNonNegativeInteger } from "../../../../core/numeric";
import { ImageField } from "../../../../mindcraft/shared-type-ids";
import { MICROBIT_LED_MATRIX_SIZE } from "../../constants";
import { builtInImageFrame, DEFAULT_BUILT_IN_IMAGE_NAME, getBuiltInImage } from "../built-in-images";
import { getMicroBitContextDevice } from "../context";
import { hasModifier, Modifier } from "../modifiers";
import { Param } from "../parameters";
import { MicroBitV2HostActions } from "../tile-ids";

/** Milliseconds a draw holds the display when the call omits the optional duration (1 second). */
export const DEFAULT_DURATION_MS = 1000;

/** The built-in image drawn when the call omits the optional image (the `happy` icon). */
export const DEFAULT_IMAGE: ClippedFrame = builtInImageFrame(getBuiltInImage(DEFAULT_BUILT_IN_IMAGE_NAME));

const callDef = mkCallDef(
  bag(repeated(Param.image, { min: 0 }), optional(Param.duration), optional(Modifier.immediately))
);

const kImageSlotId = getSlotId(callDef, Param.image);
const kDurationSlotId = getSlotId(callDef, Param.duration);
const kImmediatelySlotId = getSlotId(callDef, Modifier.immediately);

/** A draw frame clipped to the display: packed brightness bytes plus its clipped size. */
export interface ClippedFrame {
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
export function clipImage(value: Value): ClippedFrame | undefined {
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

/**
 * Clips the image slot value into an ordered sequence of display frames. The
 * slot is a `List<Image>` (the repeated anonymous image arg): each clippable
 * element becomes a frame, in order. An empty or nil slot, or one with no
 * clippable element, yields the single default image.
 */
function clipImageSequence(value: Value | undefined): ClippedFrame[] {
  const frames: ClippedFrame[] = [];
  if (isListValue(value)) {
    for (let i = 0; i < value.v.size(); i++) {
      const clipped = clipImage(value.v.get(i));
      if (clipped !== undefined) {
        frames.push(clipped);
      }
    }
  } else if (value !== undefined) {
    const clipped = clipImage(value);
    if (clipped !== undefined) {
      frames.push(clipped);
    }
  }
  if (frames.length === 0) {
    frames.push(DEFAULT_IMAGE);
  }
  return frames;
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
  const frames = clipImageSequence(args.get(kImageSlotId));
  const durationSeconds = extractNumberValue(args.get(kDurationSlotId));
  // Convert the seconds argument to whole ms at f32 precision, matching the device.
  const durationMs =
    durationSeconds === undefined ? DEFAULT_DURATION_MS : toNonNegativeInteger(Math.fround(durationSeconds * 1000));
  microbit.display.drawImage(frames, durationMs, ctx.time, () => handle.resolve(VOID_VALUE));
}

/**
 * Host actuator: paste one or more `Image`s to the simulated display top-left,
 * clipped to the 5x5 matrix. Args: the repeated anonymous `Image` slot (a
 * `List<Image>`; when empty or nil a default smiley is drawn) and the named hold
 * duration in seconds (when absent 1 second). With more than one image the
 * images play in sequence, each held for the duration, under one lease (total =
 * imageCount x duration). Asynchronous -- an explicit zero-duration draw resolves
 * at dispatch (fire-and-forget, no lease; with multiple images only the last is
 * painted); a positive-duration draw (including the default 1 second) holds the
 * display lease for the whole sequence and resolves when it elapses, with the
 * awaiting fiber parked until then. With the `immediately` modifier the current
 * display lease is preempted so the draw runs at once; otherwise a draw
 * dispatched while the display is busy is silently dropped.
 */
export default {
  ...MicroBitV2HostActions.DrawImage,
  callDef,
  fn: { exec: execDrawImage },
  isAsync: true,
  metadata: { label: "draw image" },
} satisfies CreateHostActuatorOptions;
