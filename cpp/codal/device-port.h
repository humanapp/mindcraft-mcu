#pragma once

#include <cstdint>

namespace mindcraft {

/**
 * Pixel-matrix display output. Coordinates are zero-based from the top-left;
 * dimensions are board-defined (5x5 on a micro:bit v2).
 */
class PixelDisplayPort {
public:
  virtual ~PixelDisplayPort() = default;

  /** Set one pixel's brightness: 0 is off, 255 is full brightness. */
  virtual void setPixel(uint8_t x, uint8_t y, uint8_t brightness) = 0;
};

/**
 * Momentary button input. Buttons are addressed by a zero-based index whose
 * mapping to physical buttons is board-defined (0 is button A and 1 is
 * button B on a micro:bit v2).
 */
class ButtonInputPort {
public:
  virtual ~ButtonInputPort() = default;

  /** Current level of the button: true while physically pressed. */
  virtual bool isPressed(uint8_t buttonIndex) = 0;
};

/**
 * Board-side rendering primitives for the device fault mode. The fault-mode
 * policy (stop ticking the brain, then show-the-error in a loop) lives with
 * the host loop; implementations only render. Both calls may block for the
 * duration of their animation.
 */
class FaultDisplayPort {
public:
  virtual ~FaultDisplayPort() = default;

  /** Show the board's fault indicator (a sad face on a micro:bit v2). */
  virtual void showFaultFace() = 0;

  /** Scroll a short ASCII diagnostic code across the display, once. */
  virtual void scrollFaultCode(const char* code) = 0;
};

/** Monotonic time source used to stamp think-loop ticks. */
class MonotonicClockPort {
public:
  virtual ~MonotonicClockPort() = default;

  /** Milliseconds since an arbitrary fixed origin (boot). Never decreases. */
  virtual uint32_t uptimeMillis() = 0;
};

/**
 * The full set of board ports the host loop drives. Wired once by the target
 * at startup; every pointer is non-null and non-owning, and the pointed-to
 * ports must outlive the host loop.
 */
struct DevicePorts {
  PixelDisplayPort* display;
  ButtonInputPort* buttons;
  FaultDisplayPort* faultDisplay;
  MonotonicClockPort* clock;
};

} // namespace mindcraft
