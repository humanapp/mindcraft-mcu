#include "core/codec/observable-trace.h"

namespace mindcraft {

ObservableTraceWriter::ObservableTraceWriter(TextSink& sink, const ProgramImage& program)
    : w_(sink), program_(program) {
  w_.text("mctrace ");
  w_.hex(kObservableTraceFormatVersion);
  w_.nl();
  w_.text("profile ");
  w_.hex(program.profileId);
  w_.nl();
  static_assert(sizeof(mc_number_t) == 4, "the trace renders the build profile's f32 precision");
  w_.text("precision f32");
  w_.nl();
}

void ObservableTraceWriter::tick(uint32_t ordinal, mc_number_t time, mc_number_t dt) {
  w_.text("tick ");
  w_.hex(ordinal);
  w_.text(" time ");
  w_.numberBits(time);
  w_.text(" dt ");
  w_.numberBits(dt);
  w_.nl();
}

bool ObservableTraceWriter::hostActionCall(uint32_t actionId, uint32_t callSiteId,
                                           Span<const Value> args, const Value& result) {
  if (!actionPrefix(actionId, callSiteId, args)) {
    return false;
  }
  w_.text(" result ");
  if (!valueToken(result)) {
    return false;
  }
  w_.nl();
  return true;
}

bool ObservableTraceWriter::hostActionCallAsync(uint32_t actionId, uint32_t callSiteId,
                                                Span<const Value> args) {
  if (!actionPrefix(actionId, callSiteId, args)) {
    return false;
  }
  w_.text(" async");
  w_.nl();
  return true;
}

bool ObservableTraceWriter::actionPrefix(uint32_t actionId, uint32_t callSiteId,
                                         Span<const Value> args) {
  w_.text("action ");
  w_.hex(actionId);
  w_.text(" site ");
  w_.hex(callSiteId);
  w_.text(" args ");
  w_.hex(static_cast<uint32_t>(args.size()));
  for (size_t i = 0; i < args.size(); i++) {
    w_.ch(' ');
    if (!valueToken(args[i])) {
      return false;
    }
  }
  return true;
}

void ObservableTraceWriter::displaySetPixel(mc_number_t x, mc_number_t y, mc_number_t brightness) {
  w_.text("port display set-pixel ");
  w_.numberBits(x);
  w_.ch(' ');
  w_.numberBits(y);
  w_.ch(' ');
  w_.numberBits(brightness);
  w_.nl();
}

void ObservableTraceWriter::displayScroll(const uint8_t* bytes, uint32_t length) {
  w_.text("port display scroll ");
  quoteBytes(w_, bytes, length);
  w_.nl();
}

void ObservableTraceWriter::fiberFault(uint32_t fiberId, ErrorCode code) {
  w_.text("fault ");
  w_.hex(fiberId);
  w_.ch(' ');
  w_.hex(static_cast<uint32_t>(code));
  w_.nl();
}

bool ObservableTraceWriter::valueToken(const Value& value) {
  switch (value.tag()) {
  case ValueTag::Void:
    w_.text("void");
    return true;
  case ValueTag::Nil:
    w_.text("nil");
    return true;
  case ValueTag::Boolean:
    w_.text(value.asBoolean() ? "bool 1" : "bool 0");
    return true;
  case ValueTag::Number:
    w_.text("number ");
    w_.numberBits(value.asNumber());
    return true;
  case ValueTag::String:
    w_.text("string ");
    return quoteStringTableEntry(w_, program_, value.borrowedStringIndex());
  default:
    // No other value kind has a rendering in trace format version 1.
    return false;
  }
}

} // namespace mindcraft
