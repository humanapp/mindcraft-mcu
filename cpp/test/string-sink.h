#pragma once

#include "hostkit/text-render.h"

#include <string>

/** Collects rendered text into a std::string. */
class StringTextSink : public mindcraft::TextSink {
public:
  void write(const char* bytes, size_t length) override { text_.append(bytes, length); }

  const std::string& text() const { return text_; }

private:
  std::string text_;
};
