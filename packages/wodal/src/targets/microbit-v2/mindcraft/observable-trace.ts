/**
 * Observable trace: a deterministic, line-oriented ASCII rendering of one VM
 * run's externally observable effects under a scripted input schedule. Two VM
 * implementations fed the same program and schedule produce byte-identical
 * traces; the committed trace beside a program fixture is the behavioral
 * contract a separately built VM is verified against.
 *
 * Every event is observable at the host-binding surface: host-action
 * dispatch, device-port calls, fiber faults, and the schedule's tick
 * boundaries. No line depends on VM internals.
 *
 * Trace format, version 1 (LOCKED; any change bumps
 * {@link OBSERVABLE_TRACE_FORMAT_VERSION} and regenerates every committed
 * trace):
 *
 * - The trace is ASCII with LF line endings and ends with a trailing LF.
 *   Tokens on a line are separated by single spaces; lines are not indented.
 * - Integer scalars (tick ordinals, action ids, call-site ids, argument
 *   counts, fiber ids, fault codes) render as the minimal lowercase
 *   hexadecimal of their unsigned 32-bit value with no prefix or padding
 *   ("0" for zero).
 * - Brain-observable numbers (tick time/dt stamps, device-port arguments,
 *   number-typed action arguments and results) render as the IEEE-754 bit
 *   pattern of the value at the trace's profile precision: 8 zero-padded
 *   lowercase hex digits of the f32 bits on an f32 profile, 16 digits of the
 *   f64 bits on an f64 profile.
 * - Strings render as a double-quoted UTF-8 byte sequence: bytes 0x20..0x7e
 *   are literal except `"` (renders `\"`) and `\` (renders `\\`); every
 *   other byte renders as `\xNN` with two lowercase hex digits.
 * - A value token is one of `void`, `nil`, `bool 0|1`, `number <bits>`,
 *   `string "<bytes>"`, `buffer <hex>` (two lowercase hex digits per byte,
 *   no separators; empty for an empty buffer), `struct <fieldCount>
 *   <value>...` (the field count in hex followed by one value token per field
 *   slot, in slot order; native-backed structs do not render), or `list
 *   <count> <value>...` (the element count in hex followed by one value token
 *   per element, in order; empty for an empty list). Any other value kind
 *   crossing the host-binding surface is an error in format version 1.
 *
 * Line layout: a three-line header, then events in emission order.
 *
 * ```
 * mctrace 1
 * profile <profileId>
 * precision f32|f64
 * tick <ordinal> time <bits> dt <bits>
 * action <actionId> site <callSiteId> args <argc> <value>... result <value>
 * action <actionId> site <callSiteId> args <argc> <value>... async
 * port display set-pixel <xBits> <yBits> <brightnessBits>
 * port display scroll "<bytes>"
 * port display draw <width> <height> <hex>
 * port i2c write <address> <hex>
 * port i2c read <address> <len> <hex>
 * port gpio digital-write <pin> <value>
 * port gpio digital-read <pin> <value>
 * port gpio set-pull <pin> <mode>
 * port gpio servo-write <pin> <angle>
 * fault <fiberId> <errorCode>
 * ```
 *
 * - `tick`: one scheduled think, emitted before any event of that think.
 *   `<ordinal>` is 1-based. `time` and `dt` are the schedule-driven stamps
 *   the VM observes on its execution context: `time` is the cumulative
 *   scheduled time, and `dt` is 0 when the previous think time is 0 and the
 *   difference from the previous think time otherwise. Schedule times must
 *   be exactly representable at the profile precision.
 * - `action ... result`: one synchronous host-action dispatch, emitted when
 *   the call returns. `<actionId>` is the stable registry id, `<callSiteId>`
 *   keys the per-callsite host state, the `<argc>` argument values are the
 *   positional arg buffer exactly as the binding receives it (a missing
 *   optional slot is `nil`), and `result` is the value the call pushes back.
 *   Device-port lines raised while the action body runs are emitted at the
 *   moment of the port call, before the action's own line.
 * - `action ... async`: one asynchronous host-action dispatch, emitted when
 *   the body is invoked. The leading tokens match the synchronous form; the
 *   trailing `async` marks that the call returns a pending handle rather than
 *   a value. Device-port lines raised by the body precede this line.
 * - `port display set-pixel`: one pixel write crossing the display device
 *   port, with the x/y/brightness arguments as passed to the port (before
 *   the device clamps or discards them).
 * - `port display scroll`: one scroll-text request crossing the display
 *   device port, with the scrolled text as the quoted byte sequence passed
 *   to the port.
 * - `port display draw`: one image-draw paste crossing the display device
 *   port. `<width>` and `<height>` are the clipped frame dimensions in hex
 *   (at most the display size), and `<hex>` is the clipped frame's brightness
 *   bytes (row-major, two lowercase hex digits per byte, no separators). A
 *   draw silently dropped by the lease writes nothing and emits no such line.
 * - `port i2c write`: one buffer write crossing the I2C device port.
 *   `<address>` is the 7-bit device address in hex, and `<hex>` is the bytes
 *   written (in transmission order, two lowercase hex digits per byte, no
 *   separators; empty for a zero-length write).
 * - `port i2c read`: one buffer read crossing the I2C device port. `<address>`
 *   is the 7-bit device address in hex, `<len>` is the requested byte count in
 *   hex, and `<hex>` is the bytes returned (in receive order, two lowercase hex
 *   digits per byte, no separators; empty for a no-device read).
 * - `port gpio digital-write`: one digital write crossing the GPIO device port.
 *   `<pin>` is the pin number and `<value>` the written level (0 low, nonzero
 *   high), each in hex.
 * - `port gpio digital-read`: one digital read crossing the GPIO device port.
 *   `<pin>` is the pin number and `<value>` the level read back, each in hex.
 * - `port gpio set-pull`: one pull-mode configuration crossing the GPIO device
 *   port. `<pin>` is the pin number and `<mode>` the pull mode (0 none, 1 up, 2
 *   down), each in hex.
 * - `port gpio servo-write`: one servo write crossing the GPIO device port.
 *   `<pin>` is the pin number and `<angle>` the servo angle in degrees (0-180),
 *   each in hex.
 * - `fault`: one fiber fault. `<errorCode>` is the numeric wire-stable
 *   `ErrorCode`. Fault messages are implementation-defined and never render.
 */

import { NativeType, type ReadonlyList, type Value } from "@mindcraft-lang/core/app";
import { bufferToHex, type NumberPrecision } from "@mindcraft-lang/core/runtime";

/** Current observable trace format version. */
export const OBSERVABLE_TRACE_FORMAT_VERSION = 1;

/** Construction options for {@link ObservableTraceWriter}. */
export interface ObservableTraceOptions {
  /** Numeric device-profile id of the traced program's binary envelope. */
  readonly profileId: number;

  /** Profile numeric precision; selects the numeric bit-pattern width. */
  readonly precision: NumberPrecision;
}

function hexU32(value: number): string {
  return (value >>> 0).toString(16);
}

function hexPadded(value: number, width: number): string {
  return (value >>> 0).toString(16).padStart(width, "0");
}

function numberBits(value: number, precision: NumberPrecision): string {
  if (precision === "f32") {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value);
    return hexPadded(view.getUint32(0), 8);
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return hexPadded(view.getUint32(0), 8) + hexPadded(view.getUint32(4), 8);
}

function quoted(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '"';
  for (const byte of bytes) {
    if (byte === 0x22) {
      out += '\\"';
    } else if (byte === 0x5c) {
      out += "\\\\";
    } else if (byte >= 0x20 && byte <= 0x7e) {
      out += String.fromCharCode(byte);
    } else {
      out += `\\x${hexPadded(byte, 2)}`;
    }
  }
  return `${out}"`;
}

function valueToken(value: Value, precision: NumberPrecision): string {
  switch (value.t) {
    case NativeType.Void:
      return "void";
    case NativeType.Nil:
      return "nil";
    case NativeType.Boolean:
      return `bool ${value.v ? "1" : "0"}`;
    case NativeType.Number:
      return `number ${numberBits(value.v, precision)}`;
    case NativeType.String:
      return `string ${quoted(value.v)}`;
    case NativeType.Buffer:
      return `buffer ${bufferToHex(value)}`;
    case NativeType.Struct: {
      const fields = value.v;
      if (fields === undefined) {
        throw new Error(
          `observable trace: native-backed struct has no rendering in trace format ${OBSERVABLE_TRACE_FORMAT_VERSION}`
        );
      }
      let text = `struct ${hexU32(fields.size())}`;
      for (let i = 0; i < fields.size(); i++) {
        text += ` ${valueToken(fields.get(i), precision)}`;
      }
      return text;
    }
    case NativeType.List: {
      const items = value.v;
      let text = `list ${hexU32(items.size())}`;
      for (let i = 0; i < items.size(); i++) {
        text += ` ${valueToken(items.get(i), precision)}`;
      }
      return text;
    }
    default:
      throw new Error(
        `observable trace: value kind '${value.t}' has no rendering in trace format ${OBSERVABLE_TRACE_FORMAT_VERSION}`
      );
  }
}

/**
 * Accumulates observable-trace events and renders the canonical trace text.
 * The rendering is deterministic: equal event sequences produce byte-identical
 * traces. Construction emits the three-line header; each event method appends
 * one line. Throws when an event carries a value kind the trace format does
 * not define.
 */
export class ObservableTraceWriter {
  private readonly precision: NumberPrecision;
  private out: string;

  constructor(options: ObservableTraceOptions) {
    this.precision = options.precision;
    this.out =
      `mctrace ${hexU32(OBSERVABLE_TRACE_FORMAT_VERSION)}\n` +
      `profile ${hexU32(options.profileId)}\n` +
      `precision ${options.precision}\n`;
  }

  /**
   * Records one scheduled think boundary.
   *
   * @param ordinal - 1-based tick ordinal within the schedule.
   * @param time - Cumulative scheduled time stamped on the execution context.
   * @param dt - Time delta stamped on the execution context.
   */
  tick(ordinal: number, time: number, dt: number): void {
    this.line(`tick ${hexU32(ordinal)} time ${numberBits(time, this.precision)} dt ${numberBits(dt, this.precision)}`);
  }

  /**
   * Records one completed synchronous host-action dispatch.
   *
   * @param actionId - Stable registry id of the dispatched action.
   * @param callSiteId - Call-site id the dispatch was bound to.
   * @param args - Positional arg buffer as received by the binding.
   * @param result - Value the call returned.
   */
  hostActionCall(actionId: number, callSiteId: number, args: ReadonlyList<Value>, result: Value): void {
    this.line(`${this.actionPrefix(actionId, callSiteId, args)} result ${valueToken(result, this.precision)}`);
  }

  /**
   * Records one asynchronous host-action dispatch.
   *
   * @param actionId - Stable registry id of the dispatched action.
   * @param callSiteId - Call-site id the dispatch was bound to.
   * @param args - Positional arg buffer as received by the binding.
   */
  hostActionCallAsync(actionId: number, callSiteId: number, args: ReadonlyList<Value>): void {
    this.line(`${this.actionPrefix(actionId, callSiteId, args)} async`);
  }

  /**
   * Records one pixel write crossing the display device port.
   *
   * @param x - Horizontal coordinate as passed to the port.
   * @param y - Vertical coordinate as passed to the port.
   * @param brightness - Brightness as passed to the port.
   */
  displaySetPixel(x: number, y: number, brightness: number): void {
    this.line(
      `port display set-pixel ${numberBits(x, this.precision)} ${numberBits(y, this.precision)} ${numberBits(brightness, this.precision)}`
    );
  }

  /**
   * Records one scroll-text request crossing the display device port.
   *
   * @param text - Text scrolled, as passed to the port.
   */
  displayScroll(text: string): void {
    this.line(`port display scroll ${quoted(text)}`);
  }

  /**
   * Records one image-draw paste crossing the display device port: the clipped
   * frame written to the display top-left. `width` and `height` are the clipped
   * frame dimensions (at most the display size) and `frame` holds its
   * `width * height` brightness bytes, row-major.
   *
   * @param width - Clipped frame width in columns.
   * @param height - Clipped frame height in rows.
   * @param frame - Brightness bytes, row-major, length `width * height`.
   */
  displayDraw(width: number, height: number, frame: ReadonlyArray<number>): void {
    let hex = "";
    for (let i = 0; i < frame.length; i++) {
      hex += hexPadded((frame[i] ?? 0) & 0xff, 2);
    }
    this.line(`port display draw ${hexU32(width)} ${hexU32(height)} ${hex}`);
  }

  /**
   * Records one buffer write crossing the I2C device port.
   *
   * @param address - 7-bit device address the bytes were written to.
   * @param bytes - Bytes written, in transmission order.
   */
  i2cWrite(address: number, bytes: Uint8Array): void {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += hexPadded((bytes[i] ?? 0) & 0xff, 2);
    }
    this.line(`port i2c write ${hexU32(address)} ${hex}`);
  }

  /**
   * Records one buffer read crossing the I2C device port.
   *
   * @param address - 7-bit device address the bytes were read from.
   * @param length - Number of bytes requested.
   * @param bytes - Bytes returned, in receive order (empty on a no-device read).
   */
  i2cRead(address: number, length: number, bytes: Uint8Array): void {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += hexPadded((bytes[i] ?? 0) & 0xff, 2);
    }
    this.line(`port i2c read ${hexU32(address)} ${hexU32(length)} ${hex}`);
  }

  /**
   * Records one digital write crossing the GPIO device port.
   *
   * @param pin - Pin number the value was written to.
   * @param value - Level written: 0 low, nonzero high.
   */
  gpioDigitalWrite(pin: number, value: number): void {
    this.line(`port gpio digital-write ${hexU32(pin)} ${hexU32(value)}`);
  }

  /**
   * Records one digital read crossing the GPIO device port.
   *
   * @param pin - Pin number read.
   * @param value - Level read back: 0 low, nonzero high.
   */
  gpioDigitalRead(pin: number, value: number): void {
    this.line(`port gpio digital-read ${hexU32(pin)} ${hexU32(value)}`);
  }

  /**
   * Records one pull-mode configuration crossing the GPIO device port.
   *
   * @param pin - Pin number the pull mode was set on.
   * @param mode - Pull mode: 0 none, 1 up, 2 down.
   */
  gpioSetPull(pin: number, mode: number): void {
    this.line(`port gpio set-pull ${hexU32(pin)} ${hexU32(mode)}`);
  }

  /**
   * Records one servo write crossing the GPIO device port.
   *
   * @param pin - Pin number the angle was written to.
   * @param angle - Servo angle in degrees, 0-180.
   */
  gpioServoWrite(pin: number, angle: number): void {
    this.line(`port gpio servo-write ${hexU32(pin)} ${hexU32(angle)}`);
  }

  /**
   * Records one fiber fault.
   *
   * @param fiberId - Id of the faulted fiber.
   * @param code - Numeric wire-stable `ErrorCode` of the fault.
   */
  fiberFault(fiberId: number, code: number): void {
    this.line(`fault ${hexU32(fiberId)} ${hexU32(code)}`);
  }

  /** Returns the accumulated canonical trace text. */
  render(): string {
    return this.out;
  }

  private actionPrefix(actionId: number, callSiteId: number, args: ReadonlyList<Value>): string {
    let text = `action ${hexU32(actionId)} site ${hexU32(callSiteId)} args ${hexU32(args.size())}`;
    for (let i = 0; i < args.size(); i++) {
      text += ` ${valueToken(args.get(i), this.precision)}`;
    }
    return text;
  }

  private line(text: string): void {
    this.out += `${text}\n`;
  }
}
