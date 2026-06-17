#include "doctest/doctest.h"

#include "codal/device-port.h"

#include <string>
#include <vector>

namespace {

struct RecordingDisplay : mindcraft::PixelDisplayPort {
  struct Call {
    int16_t x;
    int16_t y;
    uint8_t brightness;
  };
  std::vector<Call> calls;

  void setPixel(int16_t x, int16_t y, uint8_t brightness) override {
    calls.push_back({x, y, brightness});
  }

  void scrollText(const uint8_t*, uint32_t, uint32_t, mindcraft::mc_number_t,
                  mindcraft::AsyncHandle) override {}
};

struct FixedButtons : mindcraft::ButtonInputPort {
  bool pressed[2] = {false, false};

  bool isPressed(uint8_t buttonIndex) override { return pressed[buttonIndex]; }
};

struct RecordingFaultDisplay : mindcraft::FaultDisplayPort {
  int faceShown = 0;
  std::vector<std::string> scrolled;

  void showFaultFace() override { faceShown++; }
  void scrollFaultCode(const char* code) override { scrolled.push_back(code); }
};

struct SteppingClock : mindcraft::MonotonicClockPort {
  uint32_t now = 0;

  uint32_t uptimeMillis() override { return now; }
};

} // namespace

TEST_CASE("a host stub can implement every device port") {
  RecordingDisplay display;
  FixedButtons buttons;
  RecordingFaultDisplay faultDisplay;
  SteppingClock clock;

  mindcraft::DevicePorts ports{&display, &buttons, &faultDisplay, &clock};

  ports.display->setPixel(2, 3, 255);
  REQUIRE(display.calls.size() == 1);
  CHECK(display.calls[0].x == 2);
  CHECK(display.calls[0].y == 3);
  CHECK(display.calls[0].brightness == 255);

  buttons.pressed[0] = true;
  CHECK(ports.buttons->isPressed(0));
  CHECK_FALSE(ports.buttons->isPressed(1));

  ports.faultDisplay->showFaultFace();
  ports.faultDisplay->scrollFaultCode("E042");
  CHECK(faultDisplay.faceShown == 1);
  REQUIRE(faultDisplay.scrolled.size() == 1);
  CHECK(faultDisplay.scrolled[0] == "E042");

  clock.now = 1000;
  CHECK(ports.clock->uptimeMillis() == 1000);
}
