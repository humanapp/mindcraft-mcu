#pragma once

#include <cstdint>

#include "core/platform/span.h"
#include "core/runtime/error-code.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"
#include "hostkit/text-render.h"

namespace mindcraft {

class ManagedHeap;

/** Observable trace format version this emitter renders. */
inline constexpr uint32_t kObservableTraceFormatVersion = 1;

/**
 * Renders one VM run's observable effects as the canonical observable
 * trace: format version 1, ASCII, LF line endings, byte-identical to the
 * rendering of wodal
 * `targets/microbit-v2/mindcraft/observable-trace.ts` (the format record)
 * for the same event sequence. Construction emits the three-line header;
 * each event method appends one line. Integer scalars render as minimal
 * lowercase hex of their unsigned 32-bit value; brain-observable numbers
 * render as zero-padded IEEE-754 f32 bit patterns; strings render
 * double-quoted with non-printable bytes escaped.
 *
 * The program supplies the header's profile id and the string table that
 * resolves string-valued tokens; it must outlive the writer.
 */
class ObservableTraceWriter {
public:
  /** A writer rendering `program`'s run into `sink`; emits the header. */
  ObservableTraceWriter(TextSink& sink, const ProgramImage& program);

  /**
   * Binds the managed heap that resolves managed (heap-allocated) string values
   * when rendering string-valued tokens. Without it only borrowed program-table
   * strings render; a managed string token then reports an undefined value kind.
   */
  void setHeap(const ManagedHeap* heap) { heap_ = heap; }

  /**
   * Records one scheduled think boundary.
   *
   * @param ordinal - 1-based tick ordinal within the schedule.
   * @param time - Cumulative scheduled time stamped on the execution context.
   * @param dt - Time delta stamped on the execution context.
   */
  void tick(uint32_t ordinal, mc_number_t time, mc_number_t dt);

  /**
   * Records one completed synchronous host-action dispatch: the stable
   * action id, the bound call site, the positional arg buffer as the
   * binding received it, and the returned value. Returns false without
   * completing the line when an argument or the result carries a value kind
   * the trace format does not define (anything outside void, nil, bool,
   * number, and string); bytes already rendered stay written.
   */
  bool hostActionCall(uint32_t actionId, uint32_t callSiteId, Span<const Value> args,
                      const Value& result);

  /**
   * Records one asynchronous host-action dispatch: the stable action id, the
   * bound call site, and the positional arg buffer as the binding received it.
   * The dispatch returns a pending handle, so the line ends with `async` and
   * renders no result. Returns false without completing the line when an
   * argument carries a value kind the trace format does not define; bytes
   * already rendered stay written.
   */
  bool hostActionCallAsync(uint32_t actionId, uint32_t callSiteId, Span<const Value> args);

  /**
   * Records one pixel write crossing the display device port, with the
   * x/y/brightness arguments as passed to the port.
   */
  void displaySetPixel(mc_number_t x, mc_number_t y, mc_number_t brightness);

  /**
   * Records one scroll-text request crossing the display device port: the
   * `length` scrolled bytes as a quoted byte sequence.
   */
  void displayScroll(const uint8_t* bytes, uint32_t length);

  /**
   * Records one image-draw paste crossing the display device port: the clipped
   * frame width and height (in hex, at most the display size) and `width *
   * height` clipped brightness bytes (row-major, two lowercase hex digits each).
   */
  void displayDraw(uint32_t width, uint32_t height, const uint8_t* frame);

  /**
   * Records one buffer write crossing the I2C device port: the 7-bit `address`
   * in hex and the `length` written bytes (two lowercase hex digits each, in
   * transmission order).
   */
  void i2cWrite(uint32_t address, const uint8_t* bytes, uint32_t length);

  /**
   * Records one buffer read crossing the I2C device port: the 7-bit `address`
   * and the requested `length` in hex, then the `byteCount` returned bytes (two
   * lowercase hex digits each, in receive order; empty on a no-device read).
   */
  void i2cRead(uint32_t address, uint32_t length, const uint8_t* bytes, uint32_t byteCount);

  /**
   * Records one digital write crossing the GPIO device port: the `pin` number
   * and the written `value` (0 low, nonzero high), each in hex.
   */
  void gpioDigitalWrite(uint32_t pin, uint32_t value);

  /**
   * Records one digital read crossing the GPIO device port: the `pin` number and
   * the `value` read back (0 low, nonzero high), each in hex.
   */
  void gpioDigitalRead(uint32_t pin, uint32_t value);

  /**
   * Records one pull-mode configuration crossing the GPIO device port: the `pin`
   * number and the pull `mode` (0 none, 1 up, 2 down), each in hex.
   */
  void gpioSetPull(uint32_t pin, uint32_t mode);

  /**
   * Records one servo write crossing the GPIO device port: the `pin` number and
   * the servo `angle` in degrees (0-180), each in hex.
   */
  void gpioServoWrite(uint32_t pin, uint32_t angle);

  /**
   * Records one cached-distance read crossing the background sensor driver: the
   * `trig` and `echo` pin numbers and the distance `cm` read back (the previous
   * driver cycle's measurement), each in hex.
   */
  void sonarDistance(uint32_t trig, uint32_t echo, uint32_t cm);

  /** Records one fiber fault: the fiber id and the numeric `ErrorCode`. */
  void fiberFault(uint32_t fiberId, ErrorCode code);

private:
  bool actionPrefix(uint32_t actionId, uint32_t callSiteId, Span<const Value> args);
  bool valueToken(const Value& value);

  TextWriter w_;
  const ProgramImage& program_;
  const ManagedHeap* heap_ = nullptr;
};

} // namespace mindcraft
