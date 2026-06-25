#pragma once

#include <cstdint>

#include "core/runtime/handle-table.h"
#include "core/runtime/mc-number.h"

namespace mindcraft {

/**
 * Pixel-matrix display output. Coordinates are zero-based from the top-left;
 * dimensions are board-defined (5x5 on a micro:bit v2).
 */
class PixelDisplayPort {
public:
  virtual ~PixelDisplayPort() = default;

  /**
   * Set one pixel's brightness: 0 is off, 255 is full brightness. Coordinates
   * are signed (int16, the CODAL `Image::setPixelValue` parameter type); a write
   * whose coordinate falls outside the board's matrix is dropped by the device.
   */
  virtual void setPixel(int16_t x, int16_t y, uint8_t brightness) = 0;

  /**
   * Begin scrolling `length` ASCII bytes across the display at `delayMs` per
   * animation step, requested at logical tick time `requestTimeMs`. The call
   * returns immediately; the scroll runs asynchronously and settles `handle`
   * (resolve) when the animation completes. Scrolls serialize: one requested
   * while another is animating begins when the display next becomes free.
   */
  virtual void scrollText(const uint8_t* bytes, uint32_t length, uint32_t delayMs,
                          mc_number_t requestTimeMs, AsyncHandle handle) = 0;

  /**
   * Paste a `width` by `height` packed brightness frame (row-major, one byte per
   * pixel) to the display top-left, requested at logical tick time
   * `requestTimeMs`. The frame is already clipped to the board's matrix by the
   * caller. The call returns immediately and settles `handle` (resolve): a
   * positive `durationMs` holds the display for that long before settling, and a
   * non-positive `durationMs` settles at once without holding. A draw requested
   * while the display is busy (a scroll or a held draw) is silently dropped:
   * nothing is pasted and `handle` settles at once. The pasted frame is never
   * cleared; it persists until the next draw.
   */
  virtual void drawFrame(const uint8_t* frame, uint32_t width, uint32_t height, uint32_t durationMs,
                         mc_number_t requestTimeMs, AsyncHandle handle) = 0;

  /**
   * Release the current display lease at once: a held scroll or timed draw is
   * dropped and its handle resolved, so its awaiting rule resumes as if the
   * operation finished. A no-op when no lease is held. The display content is
   * left as-is; the next operation overwrites it.
   */
  virtual void preempt() = 0;
};

/**
 * Momentary button input. Buttons are addressed by a zero-based index whose
 * mapping to physical inputs is board-defined (0 is button A, 1 is button B,
 * and 2 is the capacitive touch logo on a micro:bit v2).
 */
class ButtonInputPort {
public:
  virtual ~ButtonInputPort() = default;

  /** Current level of the button: true while physically pressed. */
  virtual bool isPressed(uint8_t buttonIndex) = 0;
};

/**
 * Three-axis accelerometer input. Exposes the last recognized gesture as a
 * board-defined gesture code plus the current acceleration (milli-g) and
 * rotation-compensated orientation (degrees or radians). All reads are polled
 * levels: the gesture holds its last value until a new one is recognized.
 */
class AccelerometerInputPort {
public:
  virtual ~AccelerometerInputPort() = default;

  /**
   * The last recognized gesture as a board-defined gesture code (0 when none
   * has been recognized). On a micro:bit v2 the codes are the CODAL
   * accelerometer gesture values.
   */
  virtual uint16_t getGesture() = 0;

  /** Acceleration along the X axis in milli-g; signed. */
  virtual int32_t getX() = 0;

  /** Acceleration along the Y axis in milli-g; signed. */
  virtual int32_t getY() = 0;

  /** Acceleration along the Z axis in milli-g; signed. */
  virtual int32_t getZ() = 0;

  /** Rotation-compensated pitch in whole degrees; signed. */
  virtual int32_t getPitch() = 0;

  /** Rotation-compensated roll in whole degrees; signed. */
  virtual int32_t getRoll() = 0;

  /** Rotation-compensated pitch in radians; signed. */
  virtual mc_number_t getPitchRadians() = 0;

  /** Rotation-compensated roll in radians; signed. */
  virtual mc_number_t getRollRadians() = 0;
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
  AccelerometerInputPort* accelerometer;
};

} // namespace mindcraft
