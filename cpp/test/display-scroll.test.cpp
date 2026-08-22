#include "doctest/doctest.h"

#include "targets/microbit-v2/abi/display-scroll.h"

#include <cstdint>

using wendoo::kScrollDisplaySpacing;
using wendoo::kScrollDisplayWidth;
using wendoo::kScrollStepsPerCharacter;
using wendoo::scrollDurationMs;
using wendoo::scrollStepCount;

namespace {

// Independent re-simulation of CODAL AnimatedDisplay::updateScrollText, counting
// how many steps run before DISPLAY_EVT_ANIMATION_COMPLETE fires. The closed-form
// scrollStepCount must equal this for any text length.
uint32_t simulateScrollStepCount(uint32_t characterCount) {
  const uint32_t resetPeriod = kScrollDisplayWidth + kScrollDisplaySpacing;
  uint32_t scrollingPosition = 0;
  uint32_t scrollingChar = 0;
  uint32_t steps = 0;
  for (;;) {
    steps++;
    scrollingPosition++;
    if (scrollingPosition == resetPeriod) {
      scrollingPosition = 0;
      if (scrollingChar >= characterCount) {
        return steps;
      }
      scrollingChar++;
    }
  }
}

} // namespace

TEST_CASE("a character is consumed every display width plus spacing steps") {
  CHECK(kScrollStepsPerCharacter == 6);
}

TEST_CASE("the closed-form step count matches the CODAL stepping simulation") {
  for (uint32_t length = 0; length <= 16; length++) {
    CHECK(scrollStepCount(length) == simulateScrollStepCount(length));
  }
}

TEST_CASE("step count includes the trailing blank clearing cycle") {
  CHECK(scrollStepCount(0) == 6);
  CHECK(scrollStepCount(1) == 12);
  CHECK(scrollStepCount(5) == 36);
}

TEST_CASE("duration is the step count scaled by the per-step delay") {
  CHECK(scrollDurationMs(5, 120) == 36u * 120u);
  CHECK(scrollDurationMs(0, 120) == 6u * 120u);
  CHECK(scrollDurationMs(3, 60) == scrollStepCount(3) * 60u);
}
