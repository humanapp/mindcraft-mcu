#pragma once

#include <cstdint>

#include "core/codec/text-render.h"
#include "core/platform/span.h"
#include "core/runtime/error-code.h"
#include "core/runtime/mc-number.h"
#include "core/runtime/program.h"
#include "core/runtime/value.h"

namespace mindcraft {

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
   * Records one pixel write crossing the display device port, with the
   * x/y/brightness arguments as passed to the port.
   */
  void displaySetPixel(mc_number_t x, mc_number_t y, mc_number_t brightness);

  /** Records one fiber fault: the fiber id and the numeric `ErrorCode`. */
  void fiberFault(uint32_t fiberId, ErrorCode code);

private:
  bool valueToken(const Value& value);

  TextWriter w_;
  const ProgramImage& program_;
};

} // namespace mindcraft
