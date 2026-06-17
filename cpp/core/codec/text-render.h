#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "core/runtime/program.h"

namespace mindcraft {

/** Receives rendered text as a sequence of byte chunks. */
class TextSink {
public:
  /** Consumes `length` bytes of text at `bytes`. */
  virtual void write(const char* bytes, size_t length) = 0;

protected:
  ~TextSink() = default;
};

/**
 * Token-level writer for line-oriented ASCII renderings: plain text,
 * minimal-hex integer scalars, and zero-padded IEEE-754 f32 bit patterns.
 */
class TextWriter {
public:
  explicit TextWriter(TextSink& sink) : sink_(sink) {}

  /** Two spaces per depth level. */
  void indent(uint32_t depth) {
    for (uint32_t i = 0; i < depth; i++) {
      text("  ");
    }
  }

  void text(const char* s) { sink_.write(s, strlen(s)); }

  void ch(char c) { sink_.write(&c, 1); }

  void nl() { ch('\n'); }

  /** Minimal lowercase hex of a u32 ("0" for zero). */
  void hex(uint32_t value) {
    char buf[8];
    size_t len = 0;
    do {
      buf[len++] = kHexDigit[value & 0xf];
      value >>= 4;
    } while (value != 0);
    for (size_t i = 0; i < len; i++) {
      ch(buf[len - 1 - i]);
    }
  }

  /** IEEE-754 bit pattern of an f32 value, 8 zero-padded lowercase hex digits. */
  void numberBits(float value) {
    uint32_t bits = 0;
    static_assert(sizeof(bits) == sizeof(value), "f32 bit patterns are 32-bit");
    memcpy(&bits, &value, sizeof(bits));
    for (int shift = 28; shift >= 0; shift -= 4) {
      ch(kHexDigit[(bits >> shift) & 0xf]);
    }
  }

  /** One lowercase hex digit. Requires `nibble < 16`. */
  void hexDigit(uint8_t nibble) { ch(kHexDigit[nibble]); }

private:
  static constexpr const char* kHexDigit = "0123456789abcdef";

  TextSink& sink_;
};

/**
 * Emits `length` bytes double-quoted: bytes 0x20..0x7e literal except `"` and
 * `\` (backslash-escaped); every other byte as `\xNN`.
 */
inline void quoteBytes(TextWriter& w, const uint8_t* bytes, uint32_t length) {
  w.ch('"');
  for (uint32_t i = 0; i < length; i++) {
    const uint8_t b = bytes[i];
    if (b == 0x22) {
      w.text("\\\"");
    } else if (b == 0x5c) {
      w.text("\\\\");
    } else if (b >= 0x20 && b <= 0x7e) {
      w.ch(static_cast<char>(b));
    } else {
      w.text("\\x");
      w.hexDigit(b >> 4);
      w.hexDigit(b & 0xf);
    }
  }
  w.ch('"');
}

/**
 * Emits a string-table entry double-quoted via {@link quoteBytes}. Returns
 * false when the index or its byte range is outside the image's pools.
 */
inline bool quoteStringTableEntry(TextWriter& w, const ProgramImage& image, uint32_t stringIdx) {
  if (stringIdx >= image.strings.size()) {
    return false;
  }
  const StringRef ref = image.strings[stringIdx];
  if (ref.offset > image.stringData.size() || ref.length > image.stringData.size() - ref.offset) {
    return false;
  }
  quoteBytes(w, image.stringData.data() + ref.offset, ref.length);
  return true;
}

} // namespace mindcraft
